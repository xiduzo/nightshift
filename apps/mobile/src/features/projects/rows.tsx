import {
	gateParts,
	gateRun,
	type OpenGate,
	type RunSummary,
	waitedText,
} from "@nightshift/client";

import { InitialsAvatar } from "@/shared/avatar";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import { projectLinks } from "./links";
import {
	choicesText,
	gateLook,
	lastRunText,
	needsYouText,
	type ProjectOverview,
	runTime,
} from "./overview";

/** One project of the Projects tab: its initials, name, what needs you and its last run. */
export function ProjectRow({
	overview: { project, needsYou, lastRun },
	now,
}: {
	overview: ProjectOverview<{ id: string; name: string }, RunSummary>;
	now: number;
}) {
	return (
		<ListRow
			leading={<InitialsAvatar name={project.name} />}
			title={project.name}
			status={
				needsYou > 0
					? { tone: "waiting", icon: "hand", label: needsYouText(needsYou) }
					: undefined
			}
			caption={needsYou > 0 ? undefined : needsYouText(0)}
			detail={lastRunText(lastRun, now)}
			href={projectLinks.page(project.id)}
			accessibilityHint="Opens the project"
		/>
	);
}

/** An open Gate of a project: what it asks, its run, its choices and how long it has waited. */
export function ProjectGateRow({ gate, now }: { gate: OpenGate; now: number }) {
	const { flow, detail } = gateRun(gate);
	const waited = waitedText(now - gate.openedAt);
	return (
		<ListRow
			look={gateLook(gate)}
			overline={detail ? `${flow} · ${detail}` : flow}
			title={gateParts(gate.question).headline}
			caption={[
				choicesText(gate.choices.length),
				{ text: gate.nodeId, mono: true },
			]}
			value={waited}
			valueLabel={`waited ${waited}`}
			href={projectLinks.gate(gate)}
			accessibilityHint="Opens the Gate"
		/>
	);
}

/** A run of a project: its status, title and when it started (or how long it has run). */
export function ProjectRunRow({ run, now }: { run: RunSummary; now: number }) {
	const look = runStatusLook(run.status);
	const time = runTime(run, now);
	return (
		<ListRow
			look={look}
			// The caption says the status: a screen reader hears it once.
			iconLabel=""
			title={run.title}
			caption={[
				{ text: look.label, tone: look.tone },
				{ text: run.branch, mono: true },
			]}
			value={time.value}
			valueLabel={time.label}
			href={projectLinks.run(run.id)}
			accessibilityHint="Opens the run"
		/>
	);
}
