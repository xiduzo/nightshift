import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySavedProfiles } from "../adapters/out/in-memory-saved-profiles";
import { removeProfile } from "./remove-profile";

describe("removeProfile", () => {
	test("the profile of the id is gone, and the others stay", async () => {
		const entry = (name: string) => ({
			name,
			description: null,
			settings: {
				harness: "codex",
				model: "gpt-5",
				permissionMode: "acceptEdits",
				clis: [],
				connections: [],
			},
			updatedAt: 1,
		});
		const saved = inMemorySavedProfiles([
			["p-1", entry("night")],
			["p-2", entry("day")],
		]);
		await removeProfile({ computerAccess: inMemoryComputer(), saved })(
			NIGHT_SHIFT,
			{ id: "p-1" },
		);
		expect([...saved.read().keys()]).toEqual(["p-2"]);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = removeProfile({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
