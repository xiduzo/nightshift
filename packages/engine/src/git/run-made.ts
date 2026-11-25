import { isRunsBranch } from "./worktree-places";

/** A line of a log that git keeps of a ref: what it was, what it is, who and when, and why. */
type LogLine = {
	old: string;
	now: string;
	by: string;
	why: string;
	text: string;
};

/** The files git keeps: the log of a branch, and of HEAD in the run's copy. */
export type RunLogs = { branch: string; head: string };

/** What git writes for a commit that it made in the copy. A fast-forward makes none. */
const MADE = [
	/^commit( \([a-z]+\))?: /,
	/^(rebase|pull)\b.*? \((pick|reword|edit|squash|fixup|continue)\): /,
	/^(cherry-pick|revert|am): (?!fast-forward$)/,
	/^(merge|pull) .*: Merge made by /,
];
const RENAMED = /^Branch: renamed refs\/heads\/(\S+) to refs\/heads\/\S+$/;

function linesOf(log: string): LogLine[] {
	return log.split("\n").flatMap((text) => {
		const found = /^([0-9a-f]+) ([0-9a-f]+) (.*?)(?:\t(.*))?$/.exec(text);
		if (!found) return [];
		const [, old = "", now = "", by = "", why = ""] = found;
		return [{ old, now, by, why, text }];
	});
}

const isZero = (id: string) => /^0+$/.test(id);

/**
 * Whether all that is on a branch is the run's own, from the first commit
 * of the branch to `tip`, by git's own logs. The run made the branch: with a
 * checkout in its copy, at a commit it made there, or from a branch of its
 * names. And each move since is one that the copy made: git wrote the same
 * line for the copy's HEAD, or the move is to a commit that the copy made. A
 * move that only the branch has is another person's.
 *
 * A commit that the copy did not make (one it pulled or merged) must be on
 * another branch too: none of `only` may be one of them.
 *
 * The log must go on without a gap from `tip` to the first line of the
 * branch, or to `handed`: the tip the run knew before. Else it is not known.
 */
export function runMade(
	logs: RunLogs,
	run: {
		shortId: string;
		branch: string;
		tip: string;
		handed: string | null;
		/** The commits at `tip` that no branch has that the run does not move. */
		only: readonly string[];
	},
): boolean {
	const head = linesOf(logs.head);
	const sameMove = new Set(head.map((line) => line.text));
	const made = new Set(
		head
			.filter(({ why }) => MADE.some((kind) => kind.test(why)))
			.map((line) => line.now),
	);
	if (!run.only.every((commit) => made.has(commit))) return false;
	/** The names the branch had, newest first. */
	const names = [run.branch];
	let at = run.tip;
	for (const line of linesOf(logs.branch).reverse()) {
		if (at === run.handed) return true;
		if (line.now !== at) return false;
		at = line.old;
		if (isZero(line.old)) {
			return (
				made.has(line.now) ||
				names.some((name) => isRunsBranch(run.shortId, name)) ||
				head.some(
					({ now, by, why }) =>
						now === line.now &&
						by === line.by &&
						names.some(
							(name) =>
								why.startsWith("checkout: moving from ") &&
								why.endsWith(` to ${name}`),
						),
				)
			);
		}
		const renamed = RENAMED.exec(line.why)?.[1];
		if (renamed !== undefined && line.old === line.now) names.push(renamed);
		else if (!sameMove.has(line.text) && !made.has(line.now)) return false;
	}
	return at === run.handed;
}
