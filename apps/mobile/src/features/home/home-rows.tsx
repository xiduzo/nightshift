import {
	gateParts,
	gateRun,
	type OpenGate,
	waitedText,
} from "@nightshift/client";
import { GitPullRequest } from "lucide-react-native";
import { formatTime } from "@/shared/format";
import { ListRow } from "@/shared/list";
import { NEEDS_YOU, runStatusLook } from "@/shared/tone";
import type { NightRun } from "./last-night";

/**
 * A Gate that needs you: its question, its project and flow, and how long
 * it waited. A pull-request icon when the Gate links one. Tap opens it.
 */
export function GateRow({ gate, now }: { gate: OpenGate; now: number }) {
	const { headline, links } = gateParts(gate.question);
	const waited = waitedText(now - gate.openedAt);
	const pull = links.some((link) => link.kind === "pull");
	return (
		<ListRow
			look={NEEDS_YOU}
			icon={pull ? GitPullRequest : undefined}
			title={headline}
			caption={[gate.projectName, gateRun(gate).flow]}
			value={waited}
			valueLabel={`waited ${waited}`}
			href={{
				pathname: "/gates/[runId]/[stepId]",
				params: { runId: gate.runId, stepId: gate.stepId },
			}}
			accessibilityHint="Opens the Gate"
		/>
	);
}

/**
 * A run of the summary: its status, title, project and branch. A running
 * run shows how long it has been at work, an ended one when it started.
 */
export function NightRunRow({ run, now }: { run: NightRun; now: number }) {
	const look = runStatusLook(run.status);
	const running = run.status === "running";
	const value = running
		? waitedText(now - run.createdAt)
		: formatTime(run.createdAt);
	return (
		<ListRow
			look={look}
			title={run.title}
			caption={[
				{ text: look.label, tone: look.tone },
				run.group,
				{ text: run.branch, mono: true },
			]}
			detail={run.reason ?? undefined}
			value={value}
			valueLabel={running ? `at work for ${value}` : `started ${value}`}
			href={{ pathname: "/runs/[runId]", params: { runId: run.id } }}
			accessibilityHint="Opens the run"
		/>
	);
}
