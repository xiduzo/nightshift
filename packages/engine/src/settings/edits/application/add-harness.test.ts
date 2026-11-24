import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySettings } from "../../settings/adapters/out/in-memory-settings";
import { addHarness } from "./add-harness";

describe("addHarness", () => {
	test("adds a harness once", async () => {
		const settings = inMemorySettings({ harnesses: ["claude-code"] });
		const add = addHarness({ computerAccess: inMemoryComputer(), settings });
		await add(NIGHT_SHIFT, { harness: "gemini" });
		await add(NIGHT_SHIFT, { harness: "gemini" });
		expect(settings.current().harnesses).toEqual(["claude-code", "gemini"]);
		expect(settings.saved.writes).toHaveLength(1);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = addHarness({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
