import {
	type Artifact,
	actedRunStatus,
	changedFileCount,
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	hasEnded,
	markdownPreview,
	mergeSteps,
	nodeLabels,
	type OpenGate,
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
	ChevronRight,
	FileDiff,
	FileText,
	Link2,
	Share as ShareIcon,
} from "lucide-react-native";
import { useCallback } from "react";
import { Share, View } from "react-native";

import { FollowOnLockScreen } from "@/features/glance";
import { useHost, useHostQueries } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { ErrorAlert } from "@/shared/feedback";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { FactGrid, FactTile } from "@/shared/tiles";
import { StepTrail, trailItemOf } from "@/shared/trail";
import { AskWhyCard } from "./ask-why-card";
import { RunActions, useRunAct } from "./run-actions";
import {
	itemStateLabel,
	type RunLink,
	runFacts,
	runLinks,
	sizeLabel,
} from "./run-facts";
import { RunNotice } from "./run-notice";
import { RunStatusBadge } from "./status-badge";
import { type PhoneLiveRun, usePhoneLiveRun } from "./use-live-run";

/**
 * One run, live: its status, the Gates that wait in it, Stop or Resume,
 * its details, its steps as a trail, what it made, and how to take it
 * over in a terminal. Opened from the Runs tab, after a start, or from a
 * notification.
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
					<Skeleton className="h-6 w-24 rounded-full" />
					<Skeleton className="h-8 w-3/4" />
					<Skeleton className="h-40 w-full rounded-xl" />
					<Skeleton className="h-64 w-full rounded-xl" />
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
	const notice = stoppedNotice(run, status);
	const now = Date.now();

	return (
		<>
			<View className="gap-2">
				<View className="flex-row flex-wrap items-center gap-2">
					<RunStatusBadge status={status} result={shown.result} />
					{live.connection === "reconnecting" && !ended ? (
						<Text className="text-muted-foreground text-sm">Reconnecting…</Text>
					) : null}
				</View>
				<Text
					accessibilityRole="header"
					className="font-bold text-2xl tracking-tight"
				>
					{run.title}
				</Text>
				{projectName ? (
					<Link href={projectHref(run.projectId)} asChild>
						<Button
							size="lg"
							variant="link"
							className="h-auto min-h-11 self-start px-0 py-2"
							accessibilityHint="Opens the project"
						>
							<Text className="text-muted-foreground">{projectName}</Text>
							<Icon as={ChevronRight} className="text-muted-foreground" />
						</Button>
					</Link>
				) : null}
				{ended && run.reason && !notice ? (
					<Text className="text-muted-foreground text-sm">{run.reason}</Text>
				) : null}
			</View>

			{gates.length > 0 ? <GateRows gates={gates} /> : null}

			{notice ? <RunNotice notice={notice} /> : null}

			{/* Room for Ask why, beside the reason the run ended. */}

			{allows.stop || allows.resume || allows.restart || allows.rerun ? (
				<Card className="gap-4 py-4">
					<RunActions
						runId={run.id}
						allows={allows}
						act={act}
						restartStep={runningStep(steps)}
						rerunFrom={rerunStarts(steps)}
						labels={labels}
					/>
					<FollowOnLockScreen runId={run.id} ended={ended} />
				</Card>
			) : null}

			<AskWhyCard runId={run.id} status={status} />

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
				<SectionHead title="Details" />
				<FactGrid>
					{runFacts(run, {
						status,
						steps: partial ? null : ownSteps.length,
						now,
					}).map((fact) => (
						<FactTile key={fact.label} {...fact} />
					))}
				</FactGrid>
			</View>

			<StepsSection
				runId={run.id}
				steps={ownSteps}
				labels={labels}
				status={status}
				now={now}
				loading={partial}
			/>

			<ChangedFilesRow
				runId={run.id}
				changes={live.entries.changes}
				stepIds={steps.map((step) => step.id)}
			/>

			<MadeSection run={run} live={!ended} links={runLinks(steps)} />

			{run.takeOverCommand ? <TakeOver command={run.takeOverCommand} /> : null}
		</>
	);
}

function projectHref(projectId: string): Href {
	return { pathname: "/projects/[projectId]", params: { projectId } };
}

/** The Gates of this run that wait for a person. A tap opens the Gate. */
function GateRows({ gates }: { gates: OpenGate[] }) {
	return (
		<ListGroup>
			{gates.map((gate) => (
				<GateRow key={gate.stepId} gate={gate} overline={null} />
			))}
		</ListGroup>
	);
}

/** The run's own steps, in the order they started, as a trail. */
function StepsSection({
	runId,
	steps,
	labels,
	status,
	now,
	loading,
}: {
	runId: string;
	steps: StepSummary[];
	labels: Map<string, string>;
	status: RunStatus;
	now: number;
	/** The steps load still: the trail shows as loading. */
	loading: boolean;
}) {
	return (
		<View className="gap-3">
			<SectionHead
				title="Steps"
				hint="Oldest first"
				seeAll={{
					href: { pathname: "/transcript/[runId]", params: { runId } },
					label: "Transcript",
				}}
			/>
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
		</View>
	);
}

/**
 * A row that opens the files the run changed, with how many. Nothing
 * until a step changed a file.
 */
function ChangedFilesRow({
	runId,
	changes,
	stepIds,
}: {
	runId: string;
	changes: StepChanges;
	stepIds: string[];
}) {
	const groups = stepChangedFiles(changes, stepIds);
	if (groups.length === 0) return null;
	const count = changedFileCount(groups);
	const steps = groups.length;
	return (
		<ListGroup>
			<ListRow
				icon={FileDiff}
				title="Changed files"
				caption={[
					count === 1 ? "1 file" : `${count} files`,
					steps === 1 ? "in 1 step" : `in ${steps} steps`,
				]}
				href={{ pathname: "/changes/[runId]", params: { runId } }}
				accessibilityHint="Opens the files this run changed"
			/>
		</ListGroup>
	);
}

/**
 * What the run made: the links of its items (a pull request, a ticket)
 * and the files its agents kept. Nothing when it made neither.
 */
function MadeSection({
	run,
	live,
	links,
}: {
	run: RunDetail;
	live: boolean;
	links: RunLink[];
}) {
	const runQueries = useHostQueries(createRunQueries);
	const artifacts = useQuery({
		...runQueries.artifacts(run.id, live),
		...useWhileFocused(),
	});
	const files: Artifact[] = artifacts.data ?? [];
	if (links.length === 0 && files.length === 0) return null;

	return (
		<View className="gap-3">
			<SectionHead
				title="What it made"
				hint={
					files.length > 0
						? "Open the files in Night Shift on your computer."
						: undefined
				}
			/>
			<ListGroup>
				{links.map((link) => (
					<ListRow
						key={link.url}
						icon={Link2}
						title={link.title}
						caption={[
							itemStateLabel(link.state),
							link.branch ? { text: link.branch, mono: true } : "",
						]}
						onPress={() => void WebBrowser.openBrowserAsync(link.url)}
						accessibilityHint="Opens the link in the browser"
					/>
				))}
				{files.map((file) => (
					<ListRow
						key={file.id}
						icon={FileText}
						title={file.title || file.name}
						caption={[{ text: file.name, mono: true }, sizeLabel(file.size)]}
					/>
				))}
			</ListGroup>
		</View>
	);
}

/**
 * The command that opens the agent's session of this run in a terminal,
 * in mono. Touch and hold it to copy it, or share it.
 */
function TakeOver({ command }: { command: string }) {
	return (
		<View className="gap-3">
			<SectionHead
				title="Take over"
				hint="Go on with the agent in a terminal on the computer that runs it."
			/>
			<Card className="py-4">
				<CardContent className="gap-3 px-4">
					<Text
						selectable
						accessibilityHint="Touch and hold to copy the command."
						className="font-mono text-sm"
					>
						{command}
					</Text>
					<Button
						size="lg"
						variant="outline"
						className="h-auto min-h-11 self-start py-2"
						onPress={() => void Share.share({ message: command })}
						accessibilityHint="Opens the share sheet. Choose Copy to paste the command in a terminal."
					>
						<Icon as={ShareIcon} />
						<Text>Share the command</Text>
					</Button>
				</CardContent>
			</Card>
		</View>
	);
}
