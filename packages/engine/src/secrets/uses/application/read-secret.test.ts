import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { noteSecretUse } from "./note-secret-use";
import { readSecret } from "./read-secret";
import { resolveSecrets } from "./resolve-secrets";

/** The use case readSecret, on in-memory adapters. */

function wired() {
	const ports = inMemorySecretsPorts();
	const read = readSecret({
		resolve: resolveSecrets(ports),
		noteUse: noteSecretUse(ports),
	});
	return { ports, read };
}

describe("readSecret", () => {
	test("a value read is a use; a missing one is not", async () => {
		const { ports, read } = wired();
		ports.env.TOKEN = "env-value";
		expect(await read({ name: "TOKEN" })).toBe("env-value");
		expect(await read({ name: "MISSING" })).toBeUndefined();
		expect(ports.facts.uses).toEqual([new Map([["TOKEN", 120_000]])]);
	});

	test("fails closed while the Personal secrets cannot be read", async () => {
		const { ports, read } = wired();
		ports.env.TOKEN = "env-value";
		ports.personalTwin.secrets.set("TOKEN", { value: "personal", setAt: 1 });
		expect(await read({ name: "TOKEN" })).toBe("personal");
		ports.personalTwin.fail(new Error("offline"));
		expect(await read({ name: "TOKEN" })).toBeUndefined();
	});
});
