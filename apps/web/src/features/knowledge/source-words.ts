import type { RunStatus } from "@nightshift/client";
import {
	describeCron,
	type KnowledgeSource,
	knowledgeSourceKind,
} from "@nightshift/flows";

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
