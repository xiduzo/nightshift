import {
	agoLabel,
	flowLabel,
	formatKnownCost,
	hoverTime,
	type OpenGate,
	type RunSummary,
	usageLabel,
	useRunPrefetch,
	type WaitingLearning,
	waitedText,
} from "@nightshift/client";
import { router } from "expo-router";
import { FileText, Lightbulb } from "lucide-react-native";

import { useSignedIn } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { formatTime } from "@/shared/format";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import type { WatchRun } from "./latest-day";
import { reportLine, type WatchReport } from "./reports";

/**
 * A run of the latest day or one at work now: its status, title and project.
 * A run at work shows how long it has been at work, an ended one when it
 * started and what it cost.
 */
export function WatchRunRow({ run, now }: { run: WatchRun; now: number }) {
	const look = runStatusLook(run.status);
	const atWork = run.status === "running" || run.status === "waiting";
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const value = atWork
		? waitedText(now - run.createdAt)
		: formatTime(run.createdAt);
	return (
		<ListRow
			look={look}
			title={run.title}
			caption={[
				{ text: look.label, tone: look.tone },
				run.group,
				...(atWork
					? []
					: [
							usageLabel(run.tokens, formatKnownCost(run)) ??
								formatKnownCost(run),
						]),
			]}
			detail={run.reason ?? undefined}
			value={value}
			valueLabel={atWork ? `at work for ${value}` : `started ${value}`}
			href={{ pathname: "/runs/[runId]", params: { runId: run.id } }}
			onPressIn={() => prefetch(run.id)}
			accessibilityHint={`${hoverTime(run.createdAt)}. Opens the run`}
		/>
	);
}

/**
 * The newest report of a flow: its project and flow, its first line, and
 * how long ago its run ended. Tap opens the whole report.
 */
export function WatchReportRow({
	report,
	now,
}: {
	report: WatchReport;
	now: number;
}) {
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const ago = agoLabel(report.endedAt, now);
	return (
		<ListRow
			icon={FileText}
			overline={report.group}
			title={report.title}
			titleLines={1}
			caption={reportLine(report.excerpt) || undefined}
			value={ago}
			valueLabel={`ended ${ago}`}
			href={{ pathname: "/report/[runId]", params: { runId: report.runId } }}
			onPressIn={() => prefetch(report.runId)}
			accessibilityHint={`${hoverTime(report.endedAt)}. Opens the report`}
		/>
	);
}

/** A run that stopped and waits for you: when it stopped, and why. Tap opens it. */
function StoppedRunRow({
	run,
	projectName,
}: {
	run: RunSummary;
	projectName: string | undefined;
}) {
	const look = runStatusLook(run.status, run.result);
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	return (
		<ListRow
			look={look}
			overline={[projectName, flowLabel(run)].filter(Boolean).join(" · ")}
			title={run.title}
			titleLines={1}
			caption={[
				{
					text: `${look.label} at ${formatTime(run.endedAt ?? run.createdAt)}`,
					tone: look.tone,
				},
			]}
			detail={run.reason ?? undefined}
			href={{ pathname: "/runs/[runId]", params: { runId: run.id } }}
			onPressIn={() => prefetch(run.id)}
			accessibilityHint={`${hoverTime(run.endedAt ?? run.createdAt)}. Opens the run`}
		/>
	);
}

/** A learning to check: its first note. Tap opens Needs you, where you keep or delete it. */
function LearningItemRow({
	learning,
	projectName,
}: {
	learning: WaitingLearning;
	projectName: string | undefined;
}) {
	return (
		<ListRow
			icon={Lightbulb}
			overline={projectName ? `Learning · ${projectName}` : "Learning"}
			title={learning.notes[0] ?? "A learning waits for you"}
			onPress={() => router.navigate("/needs")}
			accessibilityHint="Opens Needs you, to keep or delete it"
		/>
	);
}

/** One thing that waits for you, as Needs you holds it. */
export type WatchItem =
	| { kind: "gate"; key: string; gate: OpenGate }
	| { kind: "run"; key: string; run: RunSummary }
	| { kind: "learning"; key: string; learning: WaitingLearning };

/** A compact row of Needs you: a Gate, a run that stopped, or a learning. */
export function NeedsItemRow({
	item,
	projectName,
}: {
	item: WatchItem;
	projectName: (projectId: string) => string | undefined;
}) {
	switch (item.kind) {
		case "gate":
			return <GateRow gate={item.gate} />;
		case "run":
			return (
				<StoppedRunRow
					run={item.run}
					projectName={projectName(item.run.projectId)}
				/>
			);
		case "learning":
			return (
				<LearningItemRow
					learning={item.learning}
					projectName={projectName(item.learning.projectId)}
				/>
			);
	}
}
