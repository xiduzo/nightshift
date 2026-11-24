import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryDeciderSetupPorts } from "../adapters/out/in-memory-neighbours";
import { createDeciderJob } from "../domain/setup-jobs";
import { useTypesafeDecider } from "./use-typesafe-decider";

describe("useTypesafeDecider", () => {
	test("asks for a key when none is saved", async () => {
		const twins = inMemoryDeciderSetupPorts();
		await expect(
			useTypesafeDecider({ ...twins, job: createDeciderJob() })(NIGHT_SHIFT, {
				key: null,
				here: true,
			}),
		).rejects.toThrow("Paste the key TypeSafe gave you.");
	});

	test("saves the key, the profile of that name, and the decider", async () => {
		const twins = inMemoryDeciderSetupPorts();
		await twins.profiles.save({ name: "jev", decider: "ollama" }, "old");
		const use = useTypesafeDecider({ ...twins, job: createDeciderJob() });
		const status = await use(NIGHT_SHIFT, { key: "ts-1", here: true });
		expect(status.current).toEqual({ decider: "typesafe", chosen: true });
		expect(status.typesafe.keySaved).toBe(true);
		expect(twins.profiles.list()).toMatchObject([
			{ id: "old", name: "jev", decider: "typesafe" },
		]);
	});

	test("an Agent Profile of that name stays: the new profile gets a number", async () => {
		const twins = inMemoryDeciderSetupPorts();
		await twins.profiles.save({
			name: "jev",
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "auto",
			clis: [],
			connections: [],
		});
		const use = useTypesafeDecider({ ...twins, job: createDeciderJob() });
		await use(NIGHT_SHIFT, { key: "ts-1", here: true });
		expect(twins.profiles.list().map(({ name }) => name)).toEqual([
			"jev",
			"jev_2",
		]);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = useTypesafeDecider({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
