import { describe, expect, test } from "bun:test";

import {
	applyStepChanges,
	lastWorktreeChanges,
	linesLabel,
	type StepChanges,
	stepChangedFiles,
} from "./step-changes";
import type { TranscriptEntry, WorktreeChangesEvent } from "./types";

const changes = (
	files: WorktreeChangesEvent["files"],
	extra: Partial<WorktreeChangesEvent> = {},
): WorktreeChangesEvent => ({
	type: "worktree-changes",
	from: "a",
	to: "b",
	files,
	...extra,
});

const file = (path: string, added: number, removed: number) =>
	({ path, status: "modified", added, removed }) as const;

let seq = 0;
const entry = (
	stepId: string,
	event: TranscriptEntry["event"],
): TranscriptEntry => ({
	seq: seq++,
	stepId,
	sessionId: null,
	at: 0,
	event,
});

describe("what a step changed", () => {
	test("the last worktree-changes of a step counts", () => {
		const first = changes([file("a.ts", 1, 0)]);
		const last = changes([file("a.ts", 3, 1)]);
		expect(
			lastWorktreeChanges([
				entry("s1", first),
				entry("s1", last),
				entry("s1", { type: "worktree-snapshot", tree: "t" }),
			]),
		).toBe(last);
		expect(
			lastWorktreeChanges([
				entry("s1", { type: "worktree-snapshot", tree: "t" }),
			]),
		).toBeUndefined();
	});

	test("entries lay over the changes of each step", () => {
		const empty: StepChanges = new Map();
		const one = changes([file("a.ts", 1, 0)]);
		const two = changes([file("b.ts", 2, 2)]);
		const kept = applyStepChanges(empty, [entry("s1", one), entry("s2", two)]);
		expect([...kept.keys()]).toEqual(["s1", "s2"]);
		const newer = changes([file("a.ts", 5, 0)]);
		const next = applyStepChanges(kept, [entry("s1", newer)]);
		expect(next.get("s1")).toBe(newer);
		expect(kept.get("s1")).toBe(one);
		// Nothing about files: the same map.
		const same = applyStepChanges(next, [
			entry("s1", { type: "worktree-snapshot", tree: "t" }),
		]);
		expect(same).toBe(next);
	});
});

describe("the changed files of a run, per step", () => {
	const kept: StepChanges = new Map([
		["s2", changes([file("b.ts", 2, 2), file("a.ts", 1, 1)])],
		["s1", changes([file("a.ts", 10, 3)], { overlapped: true })],
		["s3", changes([])],
		["s4", changes([], { omitted: 4 })],
	]);

	test("steps in run order, with their files and lines, nothing-changed steps left out", () => {
		const groups = stepChangedFiles(kept, ["s1", "s2", "s3", "s4", "s5"]);
		expect(groups.map((group) => group.stepId)).toEqual(["s1", "s2", "s4"]);
		expect(groups[0]).toMatchObject({
			added: 10,
			removed: 3,
			overlapped: true,
			omitted: 0,
		});
		expect(groups[1]?.files.map((f) => [f.path, f.status, f.lines])).toEqual([
			["a.ts", "edited", { added: 1, removed: 1 }],
			["b.ts", "edited", { added: 2, removed: 2 }],
		]);
		expect(groups[1]).toMatchObject({ added: 3, removed: 3 });
		expect(groups[2]).toMatchObject({ files: [], omitted: 4 });
	});

	test("lines read +added −removed", () => {
		expect(linesLabel({ added: 12, removed: 3 })).toBe("+12 −3");
		expect(linesLabel(undefined)).toBeNull();
	});
});
