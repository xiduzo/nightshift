import {
	flowLabel,
	formatKnownCost,
	type OpenGate,
	type RunSummary,
	usageLabel,
	useRunPrefetch,
	waitedText,
} from "@nightshift/client";
import { router } from "expo-router";
import { Lightbulb } from "lucide-react-native";

import { useSignedIn } from "@/features/host";
import { GateRow } from "@/features/inbox";
import type { Learning } from "@/features/learnings";
import { formatTime } from "@/shared/format";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import type { NightRun } from "./last-night";

/**
 * A run of last night or one at work now: its status, title and project.
 * A run at work shows how long it has been at work, an ended one when it
 * started and what it cost.
 */
export function NightRunRow({ run, now }: { run: NightRun; now: number }) {
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
			accessibilityHint="Opens the run"
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
			accessibilityHint="Opens the run"
		/>
	);
}

/** A learning to check: its first note. Tap opens Needs you, where you keep or delete it. */
function LearningItemRow({
	learning,
	projectName,
}: {
	learning: Learning;
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
	| { kind: "learning"; key: string; learning: Learning };

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
