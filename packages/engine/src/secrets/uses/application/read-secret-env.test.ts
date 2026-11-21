import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { noteSecretUse } from "./note-secret-use";
import { readSecretEnv } from "./read-secret-env";
import { resolveSecrets } from "./resolve-secrets";

/** The use case readSecretEnv, on in-memory adapters. */

const RUN = { spaceId: "space-1", projectId: "app", runId: "run-1" };

function wired() {
	const ports = inMemorySecretsPorts();
	const read = readSecretEnv({
		resolve: resolveSecrets(ports),
		noteUse: noteSecretUse(ports),
	});
	return { ports, read };
}

describe("readSecretEnv", () => {
	test("each name as itself, and which came from the Project", async () => {
		const { ports, read } = wired();
		ports.env.A = "env-a";
		ports.projectTwin.projects.set(
			"app",
			new Map([["B", { value: "project-b", setAt: 1 }]]),
		);
		expect(await read({ names: ["A", "B"], use: { run: RUN } })).toEqual({
			ok: true,
			env: { A: "env-a", B: "project-b" },
			fromProject: ["B"],
		});
		expect(ports.facts.uses).toHaveLength(1);
	});

	test("a missing name gives no env and is no use, with why it may have a value", async () => {
		const { ports, read } = wired();
		ports.env.A = "env-a";
		ports.personalTwin.fail(new Error("offline"));
		expect(await read({ names: ["A", "B"] })).toEqual({
			ok: false,
			missing: ["B"],
			unreachable: true,
		});
		expect(ports.facts.uses).toEqual([]);
	});
});
