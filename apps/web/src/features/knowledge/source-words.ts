import type { RunStatus } from "@nightshift/client";
import {
	describeCron,
	type KnowledgeSource,
	knowledgeSourceKind,
} from "@nightshift/flows";
import type { Knowledge } from "@/shared/api";

/** What a source fills the knowledge from, in a short line: its first value, and how many more. */
export function sourceSummary(source: KnowledgeSource): string {
	const kind = knowledgeSourceKind(source.kit);
	const values = (source.inputs[kind.main] ?? "")
		.split(kind.lines.includes(kind.main) ? /[\n,]+/ : /\n/)
		.map((value) => value.trim())
		.filter(Boolean);
	const [first, ...more] = values;
	if (first === undefined) return kind.label;
	return more.length === 0 ? first : `${first} and ${more.length} more`;
}

/** The computer a source's Subflow names, as the page lists it. */
type SourceComputer = Knowledge["syncs"][number]["computer"];

/**
 * A source's name for a person: its kind. A folder on another computer
 * says which: "Folder on studio-b", not "Folder on this computer".
 */
export function sourceTitle(
	source: KnowledgeSource,
	computer: SourceComputer,
): string {
	const kind = knowledgeSourceKind(source.kit);
	if (kind.local && computer && !computer.here) {
		return `Folder on ${computer.name}`;
	}
	return kind.label;
}

/**
 * Where a source syncs, quietly: "On studio-b". Null when its Subflow
 * names no computer, or when its title names it already (`sourceTitle`).
 */
export function computerText(
	source: KnowledgeSource,
	computer: SourceComputer,
): string | null {
	if (!computer) return null;
	if (sourceTitle(source, computer) !== knowledgeSourceKind(source.kit).label) {
		return null;
	}
	return `On ${computer.name}`;
}

/** A sync's last run, for a person: what happened and when. */
export function lastSyncText(
	last: { status: RunStatus; at: number } | null,
	relative: (at: number) => string,
): string {
	if (last === null) return "Not synced yet";
	switch (last.status) {
		case "running":
		case "waiting":
		case "sleeping":
			return "Syncing now";
		case "finished":
			return `Synced ${relative(last.at)}`;
		case "stopped":
			return `Last sync stopped ${relative(last.at)}`;
		default:
			return `Last sync failed ${relative(last.at)}`;
	}
}

/** When a sync runs on its own, for a person. */
export function scheduleText(
	schedule: { cron: string; enabled: boolean } | null,
): string | null {
	if (schedule === null) return null;
	if (!schedule.enabled) return "Its schedule is paused";
	return `Syncs ${describeCron(schedule.cron)}`;
}

/**
 * What the person may do with one source, as the server allows it: Sync
 * now starts a run, Edit saves its flow, Remove removes its flow and, for
 * a source with a schedule, the schedule, which is this computer's owner's.
 */
export function sourceActions(
	sync: Pick<Knowledge["syncs"][number], "source" | "schedule">,
	can: Knowledge["can"],
): { sync: boolean; edit: boolean; remove: boolean; removeFiles: boolean } {
	const made = sync.source !== null;
	return {
		sync: can.startRuns,
		edit: made && can.save,
		remove: made && can.remove && (sync.schedule === null || can.schedules),
		removeFiles: can.startRuns,
	};
}
