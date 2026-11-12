import { expect, test } from "bun:test";
import type { RunCopyState } from "../projects";
import { cleanupTime, whyLeave, workToKeep } from "./safety";

const state: RunCopyState = {
	worktreePath: "/x",
	exists: true,
	registered: true,
	changes: 0,
	head: { commit: "c1", branch: "nightshift/a", unsaved: 0 },
	branches: [{ name: "nightshift/a", commit: "c1", unsaved: 0 }],
};

test("a copy git does not know, or cannot read, stays; one that is gone or clean may go", () => {
	expect(whyLeave(state)).toBeNull();
	expect(whyLeave({ ...state, exists: false, head: null })).toBeNull();
	expect(whyLeave({ ...state, registered: false })).toBe(
		"git does not know its folder",
	);
	expect(whyLeave({ ...state, changes: null })).toBe(
		"git could not tell what is in it",
	);
	expect(whyLeave({ ...state, head: null })).toBe(
		"git could not tell what is in it",
	);
});

test("keeps the copy with changes or commits only here, and each branch with commits only here", () => {
	expect(workToKeep(state)).toEqual({ copy: false, branches: [] });
	expect(workToKeep({ ...state, changes: 2 }).copy).toBe(true);
	expect(
		workToKeep({
			...state,
			head: { commit: "c2", branch: "tune/1110", unsaved: 1 },
		}).copy,
	).toBe(true);
	const unsaved = { name: "nightshift/a-1-login", commit: "c3", unsaved: 2 };
	expect(
		workToKeep({ ...state, branches: [...state.branches, unsaved] }),
	).toEqual({ copy: false, branches: [unsaved] });
	// No copy left: only the branches.
	expect(
		workToKeep({
			...state,
			exists: false,
			head: null,
			changes: 0,
			branches: [unsaved],
		}),
	).toEqual({ copy: false, branches: [unsaved] });
});

test("the cleanup time counts from the end, else from the start", () => {
	expect(cleanupTime({ createdAt: 0, endedAt: 1000 }, 14)).toBe(
		1000 + 14 * 24 * 60 * 60_000,
	);
	expect(cleanupTime({ createdAt: 5, endedAt: null }, 1)).toBe(
		5 + 24 * 60 * 60_000,
	);
});
