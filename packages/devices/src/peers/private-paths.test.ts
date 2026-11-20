import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { createPrivatePaths } from "./private-paths";

/**
 * A run's worktree path shows only to the owner of the Device it is on.
 * The Space is kept here, so a Person is who they are; the registry is a
 * fake: `ada-laptop` is Ada's, `kim-pc` Kim's, `gone` unknown.
 */

let sandbox: Sandbox;

beforeEach(async () => {
	sandbox = await createSandbox();
});

afterEach(async () => {
	await sandbox.cleanup();
});

const OWNERS: Record<string, string> = { "ada-laptop": "ada", "kim-pc": "kim" };

function pathsFor(ownerHere: string | null = "ada") {
	return createPrivatePaths({
		db: sandbox.db,
		registry: {
			get: async (id) =>
				OWNERS[id] ? ({ id, ownerId: OWNERS[id] } as never) : null,
		},
		ownerId: () => ownerHere,
	});
}

const run = (id: string, thisDevice = false) => ({
	id: "run-1",
	device: { id, thisDevice },
	worktreePath: `/work/${id}`,
	takeOverCommand: `cd /work/${id}` as string | null,
});

describe("a run's worktree path", () => {
	test("shows to the owner of its Device: this computer's, or another of theirs", async () => {
		const shown = await pathsFor()(sandbox.spaceId, {
			personId: "ada",
			door: "session",
		});
		expect(await shown(run("here", true))).toEqual(run("here", true));
		expect(await shown(run("ada-laptop"))).toEqual(run("ada-laptop"));
	});

	test("hides from another Person, with the take-over command that names it", async () => {
		const shown = await pathsFor()(sandbox.spaceId, {
			personId: "kim",
			door: "session",
		});
		expect(await shown(run("here", true))).toEqual({
			...run("here", true),
			worktreePath: "",
			takeOverCommand: null,
		});
		expect(await shown(run("kim-pc"))).toEqual(run("kim-pc"));
		// A summary without a take-over command gets none.
		const { takeOverCommand: _, ...list } = run("ada-laptop");
		expect(await shown(list)).toEqual({ ...list, worktreePath: "" });
	});

	test("hides on a Device whose owner this Replica cannot tell, and on this computer before its owner is known", async () => {
		expect(
			(
				await (
					await pathsFor()(sandbox.spaceId, {
						personId: "ada",
						door: "session",
					})
				)(run("gone"))
			).worktreePath,
		).toBe("");
		expect(
			(
				await (
					await pathsFor(null)(sandbox.spaceId, {
						personId: "ada",
						door: "session",
					})
				)(run("here", true))
			).worktreePath,
		).toBe("");
	});

	test("shows to a call with no Person: this computer's own use", async () => {
		const shown = await pathsFor()(sandbox.spaceId, NIGHT_SHIFT);
		expect(await shown(run("kim-pc"))).toEqual(run("kim-pc"));
	});
});
