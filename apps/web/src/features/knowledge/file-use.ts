import { now } from "@nightshift/client";
import type { KnowledgeUse } from "@/shared/api";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How agents used each file, by path, and whether to mark the ones no run used. */
export function fileUse(report: KnowledgeUse | undefined, at = now()) {
	return {
		byPath: new Map((report?.files ?? []).map((file) => [file.path, file])),
		/** Files no run used since then are marked. Null: mark none. */
		unusedBefore:
			report?.runsUsedIt === true ? at - report.unusedDays * DAY_MS : null,
		unusedDays: report?.unusedDays ?? 30,
	};
}

export type FileUse = ReturnType<typeof fileUse>;

/**
 * No run used the file lately, and it has been here long enough to tell. A
 * file that came in yesterday says nothing yet.
 */
export function isUnused(
	use: FileUse,
	file: { path: string; changedAt: number },
): boolean {
	return (
		use.unusedBefore !== null &&
		file.changedAt < use.unusedBefore &&
		(use.byPath.get(file.path)?.lastRunAt ?? 0) < use.unusedBefore
	);
}
