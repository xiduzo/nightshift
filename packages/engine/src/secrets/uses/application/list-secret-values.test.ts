import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { listSecretValues } from "./list-secret-values";
import { resolveSecrets } from "./resolve-secrets";

/** The use case listSecretValues, on in-memory adapters. */

const RUN = { spaceId: "space-1", projectId: "app", runId: "run-1" };

function wired() {
	const ports = inMemorySecretsPorts();
	const values = listSecretValues({ ...ports, resolve: resolveSecrets(ports) });
	return { ports, values };
}

describe("listSecretValues", () => {
	test("the saved, referenced, Personal and the run's Space and Project values, once each; not a use", async () => {
		const { ports, values } = wired();
		ports.computer.values.set("SAVED", "v-saved");
		ports.facts.saved().set("SAVED", 1);
		ports.references.references.set("REF", ["github"]);
		ports.env.REF = "v-ref";
		ports.personalTwin.secrets.set("MINE", { value: "v-mine", setAt: 1 });
		ports.projectTwin.projects.set(
			"app",
			new Map([["PROJ", { value: "v-proj", setAt: 1 }]]),
		);
		ports.projectTwin.spaces.set(
			"space-1",
			new Map([["SPACE", { value: "v-ref", setAt: 1 }]]),
		);
		expect((await values({ use: { run: RUN } })).sort()).toEqual([
			"v-mine",
			"v-proj",
			"v-ref",
			"v-saved",
		]);
		expect(ports.facts.uses).toEqual([]);
	});

	test("values that cannot be read now are left out", async () => {
		const { ports, values } = wired();
		ports.env.REF = "v-ref";
		ports.references.references.set("REF", ["github"]);
		ports.projectTwin.fail(new Error("offline"));
		expect(await values({ use: { run: RUN } })).toEqual(["v-ref"]);
		expect(ports.warnings.map((w) => w.line)).toEqual([
			"[secrets] the Project secrets were not read:",
		]);
	});

	test("under an Offer, no Personal value", async () => {
		const { ports, values } = wired();
		ports.computer.values.set("SAVED", "v-saved");
		ports.facts.saved().set("SAVED", 1);
		ports.personalTwin.secrets.set("MINE", { value: "v-mine", setAt: 1 });
		expect(await values({ use: { underOffer: true } })).toEqual(["v-saved"]);
		expect(ports.personalTwin.calls).toEqual([]);
	});
});
