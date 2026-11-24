import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySettings } from "../../settings/adapters/out/in-memory-settings";
import { saveCustomAgent } from "./save-custom-agent";

const goose = {
	slug: "goose",
	label: "Goose",
	command: "goose",
	args: ["acp"],
	env: {},
};

describe("saveCustomAgent", () => {
	test("adds an agent, refuses a taken slug or a removed agent, and keeps the slug on a change", async () => {
		const settings = inMemorySettings();
		const save = saveCustomAgent({
			computerAccess: inMemoryComputer(),
			settings,
		});
		await save(NIGHT_SHIFT, { agent: goose });
		await expect(save(NIGHT_SHIFT, { agent: goose })).rejects.toThrow(
			"A custom agent named acp:goose already exists. Pick another name.",
		);
		await expect(
			save(NIGHT_SHIFT, { agent: goose, previousSlug: "gone" }),
		).rejects.toThrow("This custom agent was removed. Add it again.");
		const saved = await save(NIGHT_SHIFT, {
			agent: { ...goose, slug: "other", label: "Goose 2" },
			previousSlug: "goose",
		});
		expect(saved).toEqual({ ...goose, label: "Goose 2" });
		expect(settings.current().customAgents).toEqual([saved]);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = saveCustomAgent({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
