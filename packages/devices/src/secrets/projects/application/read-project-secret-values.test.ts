import { describe, expect, test } from "bun:test";
import { inMemoryProjectsPorts } from "../adapters/out/in-memory-neighbours";
import { readProjectSecretValues } from "./read-project-secret-values";

const step = { spaceId: "space-1", projectId: "project-1", runId: "run-1" };

describe("readProjectSecretValues", () => {
	test("in a Space this computer keeps, its own run of the Project, the Space's value over the Project's", async () => {
		const p = inMemoryProjectsPorts();
		p.places.runs.set("run-1", { walkerId: "self", ...step });
		await p.store.set(step, "A_TOKEN", "from-project", "person-ada");
		await p.store.set(step, "B_TOKEN", "value-b", "person-ada");
		await p.spaceStore.set("space-1", "A_TOKEN", "from-space", "person-ada");
		expect(await readProjectSecretValues(p)({ step })).toEqual({
			A_TOKEN: "from-space",
			B_TOKEN: "value-b",
		});
		await expect(
			readProjectSecretValues(p)({ step: { ...step, runId: "run-2" } }),
		).rejects.toThrow(
			"This device has no step of that run now. Only the device a step runs on gets the project's secrets.",
		);
	});

	test("in a Space a Host keeps, the Host checks the step", async () => {
		const p = inMemoryProjectsPorts();
		p.spaces.hosts.set("space-1", "host-1");
		const sent: unknown[] = [];
		p.calls.addHost("host-1", {
			projectSecrets: {
				values: async (input: unknown) => {
					sent.push(input);
					return { A_TOKEN: "value-a" };
				},
			},
		});
		expect(
			await readProjectSecretValues(p)({ step, names: ["A_TOKEN"] }),
		).toEqual({ A_TOKEN: "value-a" });
		await readProjectSecretValues(p)({ step });
		expect(sent).toEqual([{ ...step, names: ["A_TOKEN"] }, step]);
	});

	test("no name asks nothing", async () => {
		const p = inMemoryProjectsPorts();
		expect(await readProjectSecretValues(p)({ step, names: [] })).toEqual({});
		expect(p.spaces.asked).toEqual([]);
	});
});
