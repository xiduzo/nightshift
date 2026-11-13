import {
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	flowLabel,
	gateParts,
	isTestRun,
	markdownPreview,
	mergeSteps,
	nodeLabels,
	type OpenGate,
	plainText,
	type RunDetail,
	rerunStarts,
	runNow,
	runningStep,
	runningSteps,
	stepChangedFiles,
	stepName,
	stepState,
	TEST_RUN_HINT,
	TEST_RUN_LABEL,
	now as timeNow,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
	Bell,
	BellOff,
	CircleStop,
	FileDiff,
	FlaskConical,
	GitPullRequest,
	Hand,
	Play,
	RotateCcw,
	Share as ShareIcon,
	SquareTerminal,
} from "lucide-react-native";
import { useCallback } from "react";
import { Platform, View } from "react-native";

import { useLockScreenFollow } from "@/features/glance";
import { useHost, useHostQueries } from "@/features/host";
import { useShareTakeOver } from "@/features/inbox";
import { ErrorAlert } from "@/shared/feedback";
import { formatTime } from "@/shared/format";
import {
	NativeCustomRow,
	type NativeIcon,
	NativeList,
	NativeRow,
	NativeSection,
	NativeTextRow,
	NativeTitleRow,
} from "@/shared/native-list";
import { useWhileFocused } from "@/shared/refresh";
import { useThemeColors } from "@/shared/theme";
import { runStatusLook } from "@/shared/tone";
import { AskWhySection } from "./ask-why-section";
import { toneColor } from "./native-looks";
import {
	confirmRunAction,
	failedAction,
	type RunActionContext,
	RunActionFailure,
	useRunAct,
} from "./run-actions";
import {
	computerName,
	linkLook,
	moreActions,
	type PrimaryAction,
	primaryAction,
	type RunActionKind,
	runFacts,
	runLinks,
	runTimeLine,
	runVerdict,
} from "./run-facts";
import { RunHeader } from "./run-header";
import type { HeaderAction } from "./run-header-types";
import {
	ChangesSection,
	CostSection,
	GatesSection,
	NowSection,
	openChanges,
	openGate,
	openTranscript,
	StepsSection,
	TakeOverSection,
} from "./run-sections";
import { RunUsefulSection } from "./run-useful-section";
import { type PhoneLiveRun, usePhoneLiveRun } from "./use-live-run";

/**
 * One run, live, as a native grouped list: where it is from, its status
 * and one sentence about it, its open Gates, what it cost and changed,
 * its steps and how to take it over. Its one main action sits in the
 * header, the rarer ones in the ⋯ menu, and on iOS its other views in
 * the bottom toolbar. Opened from the Runs tab, after a start, or from a
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

	if (run.data) {
		return (
			<RunBody
				run={run.data}
				partial={run.isPlaceholderData}
				live={live}
				gates={(gates.data ?? []).filter((gate) => gate.runId === runId)}
				projectName={
					projects.data?.find((p) => p.id === run.data.projectId)?.name ?? null
				}
				refresh={refresh}
			/>
		);
	}
	return (
		<NativeList onRefresh={refresh}>
			<NativeSection>
				<NativeCustomRow>
					{run.isError ? (
						<ErrorAlert
							title="This run did not load"
							message={run.error.message}
							fix="Pull down to try again."
							onRetry={() => void run.refetch()}
						/>
					) : (
						<View className="gap-3 py-2">
							<Skeleton className="h-4 w-1/2" />
							<Skeleton className="h-7 w-3/4" />
							<Skeleton className="h-4 w-2/3" />
						</View>
					)}
				</NativeCustomRow>
			</NativeSection>
		</NativeList>
	);
}

/** The icon of each run action, in the header and the ⋯ menu. */
const ACTION_ICON: Record<RunActionKind, NativeIcon> = {
	stop: { sf: "stop.circle", lucide: CircleStop },
	resume: { sf: "play", lucide: Play },
	restart: { sf: "arrow.counterclockwise", lucide: RotateCcw },
	rerun: { sf: "arrow.clockwise", lucide: RotateCcw },
};

/** The words of each run action in the ⋯ menu. */
const ACTION_LABEL: Record<RunActionKind, string> = {
	stop: "Stop run",
	resume: "Resume run",
	restart: "Restart step",
	rerun: "Run again",
};

/** What following shows, on this phone. */
const FOLLOW_HINT =
	Platform.OS === "android"
		? "Shows the step and status of this run in a notification until it ends."
		: "Shows the step and status of this run on your lock screen until it ends.";

function RunBody({
	run,
	partial,
	live,
	gates,
	projectName,
	refresh,
}: {
	run: RunDetail;
	/** Only what a list knows of the run: its steps load still. */
	partial: boolean;
	live: PhoneLiveRun;
	gates: OpenGate[];
	projectName: string | null;
	refresh: () => Promise<unknown>;
}) {
	const { colors } = useThemeColors();
	const steps = mergeSteps(run.steps, live.steps);
	// The run's own status, live: an action lets go once the run gets there.
	const act = useRunAct(run.id, runNow(run, { status: live.status }).status);
	// A stop or resume on its way shows its result at once.
	const shown = runNow(run, { status: live.status, steps, acting: act.acting });
	const { status, ended, allows } = shown;
	const follow = useLockScreenFollow(run.id);
	const share = useShareTakeOver(run.id, run.takeOverCommand);
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
	const now = timeNow();
	const verdict = runVerdict({
		status,
		gateQuestion: gate
			? plainText(gateParts(gate.question).headline) || null
			: null,
		step: restartStep ? stepName(restartStep, labels) : null,
		computer,
		notice: shown.notice,
		pullRequests: links.filter((link) => linkLook(link.url).pullRequest).length,
	});
	const context: RunActionContext = {
		runId: run.id,
		act,
		labels,
		resumeAt,
		restartStep,
		rerunFrom,
	};
	const stepIds = steps.map((step) => step.id);
	const changed = stepChangedFiles(live.entries.changes, stepIds).length > 0;
	const look = runStatusLook(status, shown.result);
	const reconnecting = live.connection === "reconnecting" && !ended;
	const canFollow = follow.available && !ended;

	/** A run action that asks first. `label` is what the button says. */
	const runAction = (
		kind: RunActionKind,
		label: string,
		resumeLabel?: string,
	): HeaderAction => {
		const busy = act.acting?.action === kind;
		return {
			key: kind,
			label: busy ? `${label}…` : label,
			icon: ACTION_ICON[kind],
			destructive: kind === "stop",
			disabled: busy,
			onPress: () => confirmRunAction(kind, { ...context, label: resumeLabel }),
		};
	};

	const header = {
		primary: primary ? primaryItem(primary, run.id, runAction) : null,
		menu: [
			...more.map((kind) => runAction(kind, ACTION_LABEL[kind])),
			...(canFollow
				? [
						{
							key: "follow",
							label: follow.following
								? "Stop following on the lock screen"
								: "Follow on the lock screen",
							subtitle: follow.following ? undefined : FOLLOW_HINT,
							icon: follow.following
								? { sf: "bell.slash" as const, lucide: BellOff }
								: { sf: "bell" as const, lucide: Bell },
							disabled: follow.busy,
							onPress: () =>
								void (follow.following ? follow.unfollow() : follow.follow()),
						},
					]
				: []),
		],
		views: [
			{
				key: "transcript",
				label: "Transcript",
				icon: { sf: "text.bubble" as const, lucide: SquareTerminal },
				onPress: () => openTranscript(run.id),
			},
			{
				key: "changes",
				label: "Changed files",
				icon: { sf: "doc.on.doc" as const, lucide: FileDiff },
				disabled: !changed,
				onPress: () => openChanges(run.id),
			},
			...(run.takeOverCommand
				? [
						{
							key: "share",
							label: "Share the take-over command",
							icon: { sf: "square.and.arrow.up" as const, lucide: ShareIcon },
							onPress: share,
						},
					]
				: []),
		],
	};

	// Following on the lock screen: that it is on, or why it did not start.
	const followLine = !canFollow
		? undefined
		: (follow.problem ??
			(follow.following
				? "You follow this run on the lock screen."
				: undefined));

	return (
		<>
			<RunHeader {...header} />
			<NativeList onRefresh={refresh}>
				<NativeSection footer={followLine}>
					<NativeTitleRow
						overline={[projectName, flowLabel(run)]
							.filter((part) => part !== null)
							.join(" · ")}
						title={run.title}
						caption={[
							look.label,
							runTimeLine(run, status, formatTime),
							...(reconnecting ? ["Reconnecting…"] : []),
						].join(" · ")}
						captionColor={toneColor(look.tone, colors)}
					/>
					{verdict ? <NativeTextRow text={verdict} /> : null}
					{isTestRun(run) ? (
						<NativeRow
							icon={{ sf: "flask", lucide: FlaskConical }}
							iconColor={colors.mutedForeground}
							title={TEST_RUN_LABEL}
							subtitle={TEST_RUN_HINT}
						/>
					) : null}
				</NativeSection>

				{failedAction(act) ? (
					<NativeSection>
						<NativeCustomRow>
							<RunActionFailure act={act} />
						</NativeCustomRow>
					</NativeSection>
				) : null}

				{gates.length > 0 ? <GatesSection gates={gates} /> : null}

				<AskWhySection runId={run.id} status={status} />
				<RunUsefulSection run={run} status={status} />

				{talking.map((step) => {
					const message = live.entries.messages.get(step.id);
					return (
						<NowSection
							key={step.id}
							step={stepName(step, labels)}
							message={message ? markdownPreview(message.text) : null}
						/>
					);
				})}

				<CostSection facts={runFacts(run, { status, now })} />
				<ChangesSection
					run={run}
					ended={ended}
					links={links}
					changes={live.entries.changes}
					stepIds={stepIds}
					connecting={live.connection === "connecting"}
				/>
				<StepsSection
					runId={run.id}
					steps={ownSteps}
					labels={labels}
					status={status}
					now={now}
					loading={partial}
				/>
				{run.takeOverCommand ? (
					<TakeOverSection
						command={run.takeOverCommand}
						computer={computer}
						onShare={share}
					/>
				) : null}
			</NativeList>
		</>
	);
}

/** The run's one main action as a header button. */
function primaryItem(
	primary: PrimaryAction,
	runId: string,
	runAction: (
		kind: RunActionKind,
		label: string,
		resumeLabel?: string,
	) => HeaderAction,
): HeaderAction {
	switch (primary.kind) {
		case "answer":
			return {
				key: "answer",
				label: "Answer",
				subtitle: "Opens the Gate",
				icon: { sf: "hand.raised", lucide: Hand },
				onPress: () => openGate(runId, primary.stepId),
			};
		case "open":
			return {
				key: "open",
				label: primary.label,
				subtitle: "Opens the pull request in the browser",
				icon: { sf: "arrow.triangle.pull", lucide: GitPullRequest },
				onPress: () => void WebBrowser.openBrowserAsync(primary.url),
			};
		case "resume":
			return runAction(
				"resume",
				primary.label === "Retry" ? "Retry" : "Resume",
				primary.label,
			);
		case "stop":
			return runAction("stop", "Stop");
		case "rerun":
			return runAction("rerun", "Run again");
	}
}
