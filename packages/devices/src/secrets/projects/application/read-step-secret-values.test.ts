import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	callerOf,
	inMemoryProjectsPorts,
} from "../adapters/out/in-memory-neighbours";
import { readStepSecretValues } from "./read-step-secret-values";

const step = { spaceId: "space-1", projectId: "project-1", runId: "run-1" };

function withRun() {
	const p = inMemoryProjectsPorts();
	p.places.runs.set("run-1", { walkerId: "host-self", ...step });
	return p;
}

describe("readStepSecretValues", () => {
	test("a Device with a step of the run placed on it gets the run's Project values, for that run only", async () => {
		const p = withRun();
		p.work.placedRuns.add("device-a run-1");
		await p.store.set(step, "A_TOKEN", "value-a", "person-ada");
		expect(await readStepSecretValues(p)(callerOf(p.members), step)).toEqual({
			A_TOKEN: "value-a",
		});
		p.places.runs.set("run-2", {
			walkerId: "host-self",
			spaceId: "space-1",
			projectId: "project-1",
		});
		await expect(
			readStepSecretValues(p)(callerOf(p.members), { ...step, runId: "run-2" }),
		).rejects.toThrow(
			"This device has no step of that run now. Only the device a step runs on gets the project's secrets.",
		);
	});

	test("another Project or Space through this run is refused, with its step placed there", async () => {
		const p = withRun();
		p.work.placedRuns.add("device-a run-1");
		p.places.projects.set("project-2", "space-1");
		await p.store.set(step, "A_TOKEN", "value-a", "person-ada");
		await expect(
			readStepSecretValues(p)(callerOf(p.members), {
				...step,
				projectId: "project-2",
			}),
		).rejects.toThrow("This device has no step of that run now.");
		p.places.runs.set("run-1", { walkerId: "device-a", ...step, spaceId: "x" });
		await expect(
			readStepSecretValues(p)(callerOf(p.members), step),
		).rejects.toThrow("This device has no step of that run now.");
	});

	test("the Device that walks the run itself gets its Project's values, and the Space's wins", async () => {
		const p = withRun();
		p.places.runs.set("run-1", { walkerId: "device-a", ...step });
		await p.store.set(step, "A_TOKEN", "from-project", "person-ada");
		await p.spaceStore.set("space-1", "A_TOKEN", "from-space", "person-ada");
		expect(
			await readStepSecretValues(p)(callerOf(p.members), {
				...step,
				names: ["A_TOKEN"],
			}),
		).toEqual({ A_TOKEN: "from-space" });
	});

	test("another Person's Device under an Offer gets the run's Project values", async () => {
		const p = withRun();
		p.work.placedRuns.add("device-e run-1");
		p.offers.offered.add("device-e space-1");
		await p.store.set(step, "A_TOKEN", "value-a", "person-ada");
		expect(
			await readStepSecretValues(p)(
				callerOf(p.members, "person-eve", "device-e"),
				step,
			),
		).toEqual({ A_TOKEN: "value-a" });
	});

	test("refuses a Device whose Person is no Member and offers nothing, even with a step placed on it", async () => {
		const p = withRun();
		p.work.placedRuns.add("device-e run-1");
		await expect(
			readStepSecretValues(p)(
				callerOf(p.members, "person-eve", "device-e"),
				step,
			),
		).rejects.toThrow(
			"This device takes no part in that Space. Ask an owner of the Space to invite you.",
		);
	});

	test("refuses a Project of a Space another Host keeps", async () => {
		const p = withRun();
		p.spaces.hosts.set("space-1", "host-2");
		p.work.placedRuns.add("device-a run-1");
		const refused = readStepSecretValues(p)(callerOf(p.members), step);
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(
			"This computer does not keep that project.",
		);
	});
});
