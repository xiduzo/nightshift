import {
	type Artifact,
	actedRunStatus,
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	flowLabel,
	gateParts,
	hasEnded,
	markdownPreview,
	mergeSteps,
	nodeLabels,
	type OpenGate,
	plainText,
	type RunDetail,
	type RunStatus,
	rerunStarts,
	runActions,
	runningStep,
	runningSteps,
	type StepChanges,
	type StepSummary,
	stepChangedFiles,
	stepName,
	stepState,
	stoppedNotice,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, Link, Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
	FileDiff,
	FileText,
	GitPullRequest,
	Hand,
	Link2,
	Share as ShareIcon,
	SquareTerminal,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Share, View } from "react-native";

import { FollowOnLockScreen } from "@/features/glance";
import { useHost, useHostQueries } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { ErrorAlert } from "@/shared/feedback";
import { formatTime } from "@/shared/format";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { StatusText } from "@/shared/status";
import { FactTile } from "@/shared/tiles";
import { runStatusLook } from "@/shared/tone";
import { StepTrail, trailItemOf } from "@/shared/trail";
import { AskWhyCard } from "./ask-why-card";
import {
	type RunAct,
	RunActionButton,
	RunActionFailure,
	useRunAct,
} from "./run-actions";
import {
	changesSummary,
	computerName,
	linkCaption,
	linkLook,
	moreActions,
	primaryAction,
	type RunActionKind,
	type RunLink,
	runFacts,
	runLinks,
	runTimeLine,
	runVerdict,
	sizeLabel,
} from "./run-facts";
import { type PhoneLiveRun, usePhoneLiveRun } from "./use-live-run";

/**
 * One run, live: where it is from, its status and one sentence about it,
 * its one main action, what it cost and changed, and its details (steps,
 * transcript, more actions, take over) folded away. Opened from the Runs
 * tab, after a start, or from a notification.
 */
export function RunScreen({ runId }: { runId: string }) {
	const { state } = useHost();
	if (state.status === "loading") return null;
	if (state.status === "signed-out") return <Redirect href="/connect" />;
	return <SignedInRun runId={runId} />;
}

function SignedInRun({ runId }: { runId: string }) {
	const runQueries = useHostQueries(createRunQueries);
	const gateQueries = useHostQueries(createGateQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const queryClient = useQueryClient();
	// The run shows at once from a list in the cache. The steps follow.
	const run = useQuery({
		...runQueries.get(runId, queryClient),
		...useWhileFocused(),
	});
	const gates = useQuery({ ...gateQueries.open(), ...useWhileFocused() });
	const projects = useQuery({ ...projectQueries.list(), ...useWhileFocused() });
	const live = usePhoneLiveRun(runId);

	// A pull reads this run and the open Gates again, not every run.
	const refresh = useCallback(
		() =>
			Promise.all(
				[
					runQueries.getKey(runId),
					runQueries.artifactsKey(runId),
					gateQueries.all(),
				].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
			),
		[queryClient, runQueries, gateQueries, runId],
	);

	return (
		<Screen onRefresh={refresh}>
			{run.data ? (
				<RunBody
					run={run.data}
					partial={run.isPlaceholderData}
					live={live}
					gates={(gates.data ?? []).filter((gate) => gate.runId === runId)}
					projectName={
						projects.data?.find((p) => p.id === run.data.projectId)?.name ??
						null
					}
				/>
			) : run.isError ? (
				<ErrorAlert
					title="This run did not load"
					message={run.error.message}
					fix="Pull down to try again."
					onRetry={() => void run.refetch()}
				/>
			) : (
				<>
					<Skeleton className="h-5 w-1/2" />
					<Skeleton className="h-8 w-3/4" />
					<Skeleton className="h-12 w-full rounded-md" />
					<Skeleton className="h-40 w-full rounded-xl" />
				</>
			)}
		</Screen>
	);
}

function RunBody({
	run,
	partial,
	live,
	gates,
	projectName,
}: {
	run: RunDetail;
	/** Only what a list knows of the run: its steps load still. */
	partial: boolean;
	live: PhoneLiveRun;
	gates: OpenGate[];
	projectName: string | null;
}) {
	const act = useRunAct(run.id, live.status ?? run.status);
	// A stop or resume on its way shows its result at once.
	const shown = actedRunStatus(
		{
			status: live.status ?? run.status,
			result: run.result,
			walkedHere: run.walker.thisDevice,
		},
		act.acting,
	);
	const status: RunStatus = shown.status;
	const ended = hasEnded(status);
	const steps = mergeSteps(run.steps, live.steps);
	const ownSteps = steps.filter((step) => step.scope === null);
	const labels = nodeLabels(run);
	// Parallel branches run several steps at once: each that talks shows.
	const talking = ended
		? []
		: runningSteps(steps).filter(
				(step) =>
					stepState(step) === "running" &&
					(live.entries.messages.has(step.id) || step.nodeType === "agent"),
			);
	const allows = runActions(
		live.status ?? run.status,
		run.walker.thisDevice,
		run.result,
	);
	const links = runLinks(steps);
	const computer = computerName(run.device);
	const restartStep = runningStep(steps);
	const rerunFrom = rerunStarts(steps);
	const lastStep = ownSteps.at(-1);
	const resumeAt = lastStep ? stepName(lastStep, labels) : null;
	const gate = gates[0] ?? null;
	const actions = {
		status,
		allows,
		gate,
		resumeAt,
		canRestart: restartStep !== undefined,
		canRerun: rerunFrom.length > 0,
		links,
	};
	const primary = primaryAction(actions);
	const more = moreActions(actions, primary);
	const now = Date.now();
	const verdict = runVerdict({
		status,
		gateQuestion: gate
			? plainText(gateParts(gate.question).headline) || null
			: null,
		step: restartStep ? stepName(restartStep, labels) : null,
		computer,
		notice: stoppedNotice(run, status),
		pullRequests: links.filter((link) => linkLook(link.url).pullRequest).length,
	});
	const buttonProps = {
		runId: run.id,
		act,
		labels,
		resumeAt,
		restartStep,
		rerunFrom,
	};

	return (
		<>
			<View className="gap-2">
				<View className="flex-row flex-wrap items-center gap-x-1.5">
					{projectName ? (
						<>
							<Link href={projectHref(run.projectId)} asChild>
								<Button
									variant="link"
									className="h-auto min-h-11 px-0 py-2"
									accessibilityHint="Opens the project"
								>
									<Text className="text-muted-foreground text-sm underline">
										{projectName}
									</Text>
								</Button>
							</Link>
							<Text
								className="text-muted-foreground text-sm"
								importantForAccessibility="no"
							>
								·
							</Text>
						</>
					) : null}
					<Text className="py-3 text-muted-foreground text-sm">
						{flowLabel(run)}
					</Text>
				</View>
				<Text
					accessibilityRole="header"
					className="font-bold text-2xl tracking-tight"
				>
					{run.title}
				</Text>
				<View className="flex-row flex-wrap items-center gap-1.5">
					<StatusText look={runStatusLook(status, shown.result)} />
					<Text className="text-muted-foreground text-sm">
						{`· ${runTimeLine(run, status, formatTime)}`}
					</Text>
					{live.connection === "reconnecting" && !ended ? (
						<Text className="text-muted-foreground text-sm">
							· Reconnecting…
						</Text>
					) : null}
				</View>
				{verdict ? (
					<Text className="text-base" numberOfLines={6}>
						{verdict}
					</Text>
				) : null}
			</View>

			<View className="gap-3">
				{primary ? (
					<PrimaryButton
						primary={primary}
						runId={run.id}
						buttonProps={buttonProps}
					/>
				) : null}
				<AskWhyCard runId={run.id} status={status} />
				<FollowOnLockScreen runId={run.id} ended={ended} />
				<RunActionFailure act={act} />
			</View>

			{gates.length > 1 ? (
				<View className="gap-3">
					<SectionHead
						title="Gates"
						hint={`${gates.length} wait in this run`}
					/>
					<ListGroup>
						{gates.map((open) => (
							<GateRow key={open.stepId} gate={open} overline={null} />
						))}
					</ListGroup>
				</View>
			) : null}

			{talking.map((step) => {
				const message = live.entries.messages.get(step.id);
				return (
					<View key={step.id} className="gap-3">
						<SectionHead title="Now" hint={stepName(step, labels)} />
						<Card className="py-4">
							<CardContent className="px-4">
								<Text
									numberOfLines={8}
									className={message ? undefined : "text-muted-foreground"}
								>
									{message
										? markdownPreview(message.text)
										: "No message from this step yet."}
								</Text>
							</CardContent>
						</Card>
					</View>
				);
			})}

			<View className="gap-3">
				<SectionHead title="What it cost and changed" />
				<View className="flex-row gap-3">
					{runFacts(run, { status, now }).map((fact) => (
						<FactTile key={fact.label} {...fact} />
					))}
				</View>
				<Evidence
					run={run}
					ended={ended}
					links={links}
					changes={live.entries.changes}
					stepIds={steps.map((step) => step.id)}
					connecting={live.connection === "connecting"}
				/>
			</View>

			<Details
				runId={run.id}
				steps={ownSteps}
				labels={labels}
				status={status}
				now={now}
				loading={partial}
				more={more}
				buttonProps={buttonProps}
				command={run.takeOverCommand}
				computer={computer}
			/>
		</>
	);
}

function projectHref(projectId: string): Href {
	return { pathname: "/projects/[projectId]", params: { projectId } };
}

type ButtonProps = Omit<
	Parameters<typeof RunActionButton>[0],
	"action" | "primary" | "label"
> & { act: RunAct };

/** The run's one main action, full width. */
function PrimaryButton({
	primary,
	runId,
	buttonProps,
}: {
	primary: NonNullable<ReturnType<typeof primaryAction>>;
	runId: string;
	buttonProps: ButtonProps;
}) {
	switch (primary.kind) {
		case "answer":
			return (
				<Link
					href={{
						pathname: "/gates/[runId]/[stepId]",
						params: { runId, stepId: primary.stepId },
					}}
					asChild
				>
					<Button
						size="lg"
						className="h-auto min-h-11 py-2"
						accessibilityHint="Opens the Gate"
					>
						<Icon as={Hand} />
						<Text>Answer the Gate</Text>
					</Button>
				</Link>
			);
		case "open":
			return (
				<Button
					size="lg"
					className="h-auto min-h-11 py-2"
					onPress={() => void WebBrowser.openBrowserAsync(primary.url)}
					accessibilityHint="Opens the pull request in the browser"
				>
					<Icon as={GitPullRequest} />
					<Text>{primary.label}</Text>
				</Button>
			);
		case "resume":
			return (
				<RunActionButton
					{...buttonProps}
					action="resume"
					label={primary.label}
					primary
				/>
			);
		default:
			return <RunActionButton {...buttonProps} action={primary.kind} primary />;
	}
}

/**
 * What the run changed and made: a row that opens its changed files, a
 * row per link of its items (a pull request opens on GitHub), and the
 * files its agents kept.
 */
function Evidence({
	run,
	ended,
	links,
	changes,
	stepIds,
	connecting,
}: {
	run: RunDetail;
	ended: boolean;
	links: RunLink[];
	changes: StepChanges;
	stepIds: string[];
	/** The changes load still: no row says "none" yet. */
	connecting: boolean;
}) {
	const runQueries = useHostQueries(createRunQueries);
	const artifacts = useQuery({
		...runQueries.artifacts(run.id, !ended),
		...useWhileFocused(),
	});
	const files: Artifact[] = artifacts.data ?? [];
	const groups = stepChangedFiles(changes, stepIds);

	return (
		<ListGroup>
			{groups.length > 0 ? (
				<ListRow
					icon={FileDiff}
					title="Changed files"
					caption={changesSummary(groups)}
					href={{ pathname: "/changes/[runId]", params: { runId: run.id } }}
					accessibilityHint="Opens the files this run changed"
				/>
			) : connecting ? (
				<Skeleton className="m-4 h-6 w-1/2" />
			) : (
				<ListRow
					icon={FileDiff}
					title={ended ? "No files changed" : "No files changed yet"}
				/>
			)}
			{links.map((link) => {
				const look = linkLook(link.url);
				return (
					<ListRow
						key={link.url}
						icon={look.pullRequest ? GitPullRequest : Link2}
						title={link.title}
						caption={linkCaption(look)}
						onPress={() => void WebBrowser.openBrowserAsync(link.url)}
						accessibilityHint="Opens the link in the browser"
					/>
				);
			})}
			{files.map((file) => (
				<ListRow
					key={file.id}
					icon={FileText}
					title={file.title || file.name}
					caption={[
						{ text: file.name, mono: true },
						sizeLabel(file.size),
						"Opens on the desktop",
					]}
				/>
			))}
		</ListGroup>
	);
}

/**
 * Details, folded away at first: the run's own steps as a trail, a row
 * that opens the transcript, the rarer actions, and how to take the run
 * over in a terminal.
 */
function Details({
	runId,
	steps,
	labels,
	status,
	now,
	loading,
	more,
	buttonProps,
	command,
	computer,
}: {
	runId: string;
	steps: StepSummary[];
	labels: Map<string, string>;
	status: RunStatus;
	now: number;
	/** The steps load still: the trail shows as loading. */
	loading: boolean;
	more: RunActionKind[];
	buttonProps: ButtonProps;
	command: string | null;
	computer: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<View className="gap-3">
			<SectionHead
				title="Details"
				hint="Steps, transcript and take over"
				seeAll={{
					onPress: () => setOpen((was) => !was),
					label: open ? "Hide" : "Show",
				}}
			/>
			{open ? (
				<>
					<Card className="py-4">
						<CardContent className="px-4">
							{loading ? (
								<Skeleton className="h-32 w-full rounded-xl" />
							) : steps.length === 0 ? (
								<Text className="text-muted-foreground">
									The first step starts soon.
								</Text>
							) : (
								<StepTrail
									items={steps.map((step) =>
										trailItemOf(step, { labels, runStatus: status, now }),
									)}
								/>
							)}
						</CardContent>
					</Card>
					<ListGroup>
						<ListRow
							icon={SquareTerminal}
							title="Transcript"
							caption="What the agent did, step by step"
							href={{ pathname: "/transcript/[runId]", params: { runId } }}
							accessibilityHint="Opens the transcript of this run"
						/>
					</ListGroup>
					{more.length > 0 ? (
						<View className="gap-2">
							<Text className="font-medium text-muted-foreground text-sm">
								More actions
							</Text>
							{more.map((action) => (
								<RunActionButton
									key={action}
									{...buttonProps}
									action={action}
								/>
							))}
						</View>
					) : null}
					{command ? <TakeOver command={command} computer={computer} /> : null}
				</>
			) : null}
		</View>
	);
}

/**
 * The command that opens the agent's session of this run in a terminal,
 * in mono. Touch and hold it to copy it, or share it.
 */
function TakeOver({
	command,
	computer,
}: {
	command: string;
	computer: string;
}) {
	return (
		<Card className="py-4">
			<CardContent className="gap-3 px-4">
				<Text className="font-medium text-muted-foreground text-sm">
					Take over
				</Text>
				<View className="rounded-md bg-muted p-3">
					<Text
						selectable
						accessibilityHint="Touch and hold to copy the command."
						className="font-mono text-sm"
					>
						{command}
					</Text>
				</View>
				<Text className="text-muted-foreground text-sm">
					{`Go on with the agent in a terminal on ${computer}.`}
				</Text>
				<Button
					size="lg"
					variant="outline"
					className="h-auto min-h-11 py-2"
					onPress={() => void Share.share({ message: command })}
					accessibilityHint="Opens the share sheet. Choose Copy to paste the command in a terminal."
				>
					<Icon as={ShareIcon} />
					<Text>Share the command</Text>
				</Button>
			</CardContent>
		</Card>
	);
}
