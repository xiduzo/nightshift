/**
 * The debt lists of `scripts/check-verticals.ts`. A debt list names what
 * broke a rule on the day the rule started, one line per offender. The
 * check fails an offender that is not on the list, and fails a line once
 * its offender is gone. So a list only gets shorter.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { debtOf } from "../check-time";

/** Rules (o) and (p): sub-verticals. */
export const NESTING_DEBT = "scripts/nesting-debt.txt";
/** Rule (n): kind folders inside a vertical. */
export const KIND_FOLDER_DEBT = "scripts/kind-folder-debt.txt";

/** One offender: its line on the debt list, and what to tell the person. */
export type Finding = { line: string; message: string };

/** The lines of the debt list `file` of `root`. A missing list is empty. */
export function debtList(root: string, file: string): string[] {
	const path = join(root, file);
	return existsSync(path) ? debtOf(readFileSync(path, "utf8")) : [];
}

/** The lines of a debt list that name a path of `workspace`. */
export const linesOf = (lines: string[], workspace: string): string[] =>
	lines.filter((line) => line.startsWith(`${workspace}/`));

/**
 * The problems of one rule with its debt list `file`: the message of each
 * finding that is not `listed`, and each listed line that no finding has
 * any more.
 */
export function ratchet(
	file: string,
	listed: string[],
	found: Finding[],
): string[] {
	const debt = new Set(listed);
	const lines = new Set(found.map((finding) => finding.line));
	const problems = found
		.filter((finding) => !debt.has(finding.line))
		.map((finding) => finding.message);
	for (const line of [...debt].sort()) {
		if (!lines.has(line))
			problems.push(`${file}: "${line}" is clean now. Remove the line.`);
	}
	return problems;
}
