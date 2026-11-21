import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { listExportValues } from "./list-export-values";
import { listSecretValues } from "./list-secret-values";
import { resolveSecrets } from "./resolve-secrets";

/** The use case listExportValues, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

function wired(ports = inMemorySecretsPorts()) {
	const secretValues = listSecretValues({
		...ports,
		resolve: resolveSecrets(ports),
	});
	return { ports, exported: listExportValues({ ...ports, secretValues }) };
}

describe("listExportValues", () => {
	test("the secret values and the Project's when this computer keeps them", async () => {
		const { ports, exported } = wired();
		ports.computer.values.set("SAVED", "v-saved");
		ports.facts.saved().set("SAVED", 1);
		ports.projectTwin.projects.set(
			"app",
			new Map([["PROJ", { value: "v-proj", setAt: 1 }]]),
		);
		expect(await exported({ project: PROJECT })).toEqual(["v-saved", "v-proj"]);
	});

	test("without a Project scope, or while it cannot be read, only the secret values", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("SAVED", "v-saved");
		ports.facts.saved().set("SAVED", 1);
		expect(
			await wired({ ...ports, ...ports.without("projects") }).exported({
				project: PROJECT,
			}),
		).toEqual(["v-saved"]);
		ports.projectTwin.fail(new Error("offline"));
		expect(await wired(ports).exported({ project: PROJECT })).toEqual([
			"v-saved",
		]);
	});
});
