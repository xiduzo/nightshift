import { describe, expect, test } from "bun:test";
import { firstCommit, runMade, wasAt } from "./run-made";

const ZERO = "0".repeat(40);
/** A commit by a letter. */
const id = (letter: string) =>
	letter.codePointAt(0)?.toString(16).repeat(20) as string;
const RUN = "Night <n@x> 100 +0000";
const THEM = "Them <t@x> 90 +0000";

/** A line of a log: `from > to`, by whom, and why. `-`: no commit. */
function line(move: string, why: string, by = RUN): string {
	const [from = "", to = ""] = move
		.split(">")
		.map((letter) => (letter === "-" ? ZERO : id(letter)));
	return `${from} ${to} ${by}${why === "" ? "" : `\t${why}`}`;
}
const log = (...lines: string[]) => lines.map((l) => `${l}\n`).join("");

const born = line("->b", "branch: Created from HEAD");
const birth = line("b>b", "checkout: moving from nightshift/abcdef12 to feat");
const one = line("b>c", "commit: one");

type Run = Parameters<typeof runMade>[1];

const made = (branch: string[], head: string[], run: Partial<Run> = {}) =>
	runMade({ branch: log(...branch), head: log(...head) }, {
		shortId: "abcdef12",
		branch: "feat",
		tip: id("c"),
		handed: null,
		bornOn: null,
		only: [],
		...run,
	} as Run);

describe("the run's", () => {
	test("a branch made with a checkout in the copy, and its commits", () => {
		expect(made([born, one], [birth, one])).toBe(true);
		expect(made([born], [birth], { tip: id("b") })).toBe(true);
	});

	test("a branch made at a commit that was somewhere else then", () => {
		const theirs = line("->b", "branch: Created from origin/pr", THEM);
		expect(made([theirs, one], [one], { bornOn: id("b") })).toBe(true);
		expect(made([theirs, one], [one], { bornOn: id("c") })).toBe(false);
		// Each move after it is still the copy's.
		const theirsToo = line("b>d", "commit: theirs", THEM);
		expect(
			made(
				[theirs, theirsToo, line("d>c", "commit: one")],
				[line("d>c", "commit: one")],
				{
					bornOn: id("b"),
				},
			),
		).toBe(false);
	});

	test("a branch made at a commit of the run", () => {
		const at = line("a>b", "commit (amend): x");
		expect(made([born, one], [at, one])).toBe(true);
	});

	test("every move that the copy's HEAD made too", () => {
		for (const why of [
			"reset: moving to HEAD~2",
			"pull origin main: Merge made by the 'ort' strategy.",
			"pull /a/folder main: Fast-forward",
			"merge main: Fast-forward",
			"cherry-pick: x",
			"am: x",
			"revert: x",
		]) {
			const move = line("b>c", why);
			expect([why, made([born, move], [birth, move])]).toEqual([why, true]);
		}
	});

	test("a rebase, by the commits it made", () => {
		for (const rebase of [
			"rebase",
			"rebase -i",
			"pull --rebase origin main",
			"pull",
		]) {
			for (const step of [
				"pick",
				"reword",
				"edit",
				"squash",
				"fixup",
				"continue",
			]) {
				expect(
					made(
						[born, line("b>c", `${rebase} (finish): refs/heads/feat onto x`)],
						[birth, line("a>c", `${rebase} (${step}): one`)],
					),
				).toBe(true);
			}
		}
	});

	test("a branch that got a new name, and more than one", () => {
		const renamed = (from: string, to: string) =>
			line("c>c", `Branch: renamed refs/heads/${from} to refs/heads/${to}`);
		expect(
			made(
				[born, one, renamed("feat", "topic"), renamed("topic", "last")],
				[birth, one],
				{ branch: "last" },
			),
		).toBe(true);
		for (const own of ["nightshift/abcdef12", "nightshift/abcdef12-item"]) {
			expect(made([born, one, renamed(own, "feat")], [one])).toBe(true);
		}
	});

	test("what came after the tip it handed on", () => {
		const theirs = line("-> b".replace(" ", ""), "", THEM);
		expect(made([theirs, one], [one], { handed: id("b") })).toBe(true);
		// Its older lines are gone.
		expect(made([one], [one], { handed: id("b") })).toBe(true);
		expect(made([], [], { handed: id("c") })).toBe(true);
		expect(made([theirs, one], [], { handed: id("c") })).toBe(true);
	});
});

describe("not the run's", () => {
	test("a branch made somewhere else, at another time, or not with that checkout", () => {
		expect(
			made([line("->b", "branch: Created from main", THEM), one], [birth, one]),
		).toBe(false);
		expect(made([born, one], [one])).toBe(false);
		for (const other of [
			line("b>b", "checkout: moving from x to other"),
			line("b>b", "checkout: moving from x to my-feat"),
			line("b>d", "checkout: moving from x to feat"),
			line("b>b", "reset: moving from x to feat"),
			line("b>b", "Branch: renamed refs/heads/feat to refs/heads/feat"),
		]) {
			expect([other, made([born, one], [other, one])]).toEqual([other, false]);
		}
	});

	test("a move that the copy's HEAD did not make", () => {
		for (const theirs of [
			line("b>c", "commit: one", THEM),
			line("b>c", "fetch origin x:feat: fast-forward"),
			line("b>c", ""),
			line("b>c", "branch: Reset to x"),
			line("b>c", "rebase (finish): refs/heads/feat onto x"),
		]) {
			expect(made([born, theirs], [birth])).toBe(false);
			expect(
				made(
					[born, theirs],
					[birth, line("b>c", "checkout: moving from x to feat")],
				),
			).toBe(false);
		}
		// Also when the copy's own commits are on top of it.
		expect(
			made(
				[born, line("b>d", "commit: theirs", THEM), line("d>c", "commit: one")],
				[birth, line("d>c", "commit: one")],
			),
		).toBe(false);
	});

	test("a commit that was only replayed by a fast-forward", () => {
		for (const why of [
			"cherry-pick: fast-forward",
			"rebase: fast-forward",
			"rebase (start): checkout x",
			"rebase (finish): returning to refs/heads/feat",
			"pull (start): checkout x",
			"checkout: moving from x (pick): to y",
		]) {
			expect([
				why,
				made([born, line("b>c", "", THEM)], [birth, line("a>c", why)]),
			]).toEqual([why, false]);
		}
	});

	test("a commit that it pulled or merged, and that no other branch has", () => {
		const pulled = line("b>c", "pull /a/folder main: Fast-forward");
		expect(made([born, pulled], [birth, pulled], { only: [id("c")] })).toBe(
			false,
		);
		const merge = "Merge made by the 'ort' strategy.";
		for (const why of [`pull x main: ${merge}`, `merge x: ${merge}`]) {
			const merged = line("b>c", why);
			const only = [id("c")];
			expect(made([born, merged], [birth, merged], { only })).toBe(true);
			expect(
				made([born, merged], [birth, merged], { only: [...only, id("d")] }),
			).toBe(false);
		}
		// Its own commits need no other branch.
		for (const why of [
			"commit: one",
			"commit (merge): one",
			"cherry-pick: one",
			"revert: one",
			"am: one",
			"rebase (pick): one",
		]) {
			const own = line("b>c", why);
			expect([
				why,
				made([born, own], [birth, own], { only: [id("c")] }),
			]).toEqual([why, true]);
		}
		for (const why of [
			"merge x: Fast-forward",
			"cherry-pick: fast-forward",
			"reset: moving to x",
		]) {
			const own = line("b>c", why);
			expect([
				why,
				made([born, own], [birth, own], { only: [id("c")] }),
			]).toEqual([why, false]);
		}
		// Also when it was handed on before.
		expect(made([], [], { handed: id("c"), only: [id("d")] })).toBe(false);
	});

	test("a log without its first line, with a gap, or that ends somewhere else", () => {
		expect(made([one], [birth, one])).toBe(false);
		expect(made([], [birth, one])).toBe(false);
		expect(
			made(
				[born, line("d>c", "commit: one")],
				[birth, line("d>c", "commit: one")],
			),
		).toBe(false);
		expect(made([born, one], [birth, one], { tip: id("d") })).toBe(false);
		expect(made(["not a line", one], [birth, one])).toBe(false);
	});

	test("a new name that came with another commit", () => {
		const moved = line(
			"b>c",
			"Branch: renamed refs/heads/x to refs/heads/feat",
		);
		expect(made([born, moved], [birth])).toBe(false);
		// The name of a person's branch does not make it the run's.
		expect(
			made(
				[
					line("->c", "branch: Created from HEAD", THEM),
					line("c>c", "Branch: renamed refs/heads/x to refs/heads/feat"),
				],
				[line("c>c", "checkout: moving from feat to x")],
			),
		).toBe(false);
	});
});

test("the first commit of a branch, and where a ref was", () => {
	expect(firstCommit(log(born, one))).toBe(id("b"));
	expect(firstCommit(log(one))).toBeNull();
	expect(firstCommit("")).toBeNull();
	expect(wasAt(log(born, one), id("c"))).toBe(true);
	expect(wasAt(log(born, one), id("d"))).toBe(false);
});
