import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { noteSecretUse } from "./note-secret-use";
import { readWebhookSecret } from "./read-webhook-secret";
import { resolveSecrets } from "./resolve-secrets";

/** The use case readWebhookSecret, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

function wired(ports = inMemorySecretsPorts()) {
	const read = readWebhookSecret({
		...ports,
		resolve: resolveSecrets(ports),
		noteUse: noteSecretUse(ports),
	});
	return { ports, read };
}

describe("readWebhookSecret", () => {
	test("the Project's value when this computer keeps it", async () => {
		const { ports, read } = wired();
		ports.env.HOOK = "env-value";
		ports.projectTwin.projects.set(
			"app",
			new Map([["HOOK", { value: "project-value", setAt: 1 }]]),
		);
		expect(await read({ name: "HOOK", project: PROJECT })).toBe(
			"project-value",
		);
		expect(ports.facts.uses).toHaveLength(1);
	});

	test("else as any secret: no value comes from another Host", async () => {
		const { ports, read } = wired();
		ports.env.HOOK = "env-value";
		ports.projectTwin.keptElsewhere();
		expect(await read({ name: "HOOK", project: PROJECT })).toBe("env-value");
	});

	test("undefined while the Project's secrets cannot be read, with the reason logged", async () => {
		const { ports, read } = wired();
		ports.env.HOOK = "env-value";
		ports.projectTwin.fail(new Error("offline"));
		expect(await read({ name: "HOOK", project: PROJECT })).toBeUndefined();
		expect(ports.warnings.map((w) => w.line)).toEqual([
			"[secrets] the Project secrets were not read:",
		]);
	});
});
