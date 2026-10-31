import type { RunSummary } from "@nightshift/client";

import { InitialsAvatar } from "@/shared/avatar";
import { useClock } from "@/shared/clock";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import { projectLinks } from "./links";
import {
	lastRunText,
	needsYouText,
	type ProjectOverview,
	runTime,
} from "./overview";

/** One project of the Projects tab: its initials, name, what needs you and its last run. It keeps "3 h ago" current itself. */
export function ProjectRow({
	overview: { project, needsYou, lastRun },
}: {
	overview: ProjectOverview<
		{ id: string; name: string },
		Pick<RunSummary, "id" | "projectId" | "title" | "createdAt">
	>;
}) {
	const now = useClock();
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

/** A run of a project: its status, title and when it started (or how long it has run), kept current. */
export function ProjectRunRow({ run }: { run: RunSummary }) {
	const now = useClock();
	const look = runStatusLook(run.status, run.result);
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
