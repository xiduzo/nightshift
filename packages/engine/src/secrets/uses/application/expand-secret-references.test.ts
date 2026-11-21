import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { expandSecretReferences } from "./expand-secret-references";
import { noteSecretUse } from "./note-secret-use";
import { resolveSecrets } from "./resolve-secrets";

/** The use case expandSecretReferences, on in-memory adapters. */

/** `${NAME}`: a reference to a secret. */
const ref = (name: string) => `\${${name}}`;

function wired() {
	const ports = inMemorySecretsPorts();
	const expand = expandSecretReferences({
		resolve: resolveSecrets(ports),
		noteUse: noteSecretUse(ports),
	});
	return { ports, expand };
}

describe("expandSecretReferences", () => {
	test("each reference expanded, with the values read for it", async () => {
		const { ports, expand } = wired();
		ports.env.KEY = "k1";
		expect(
			await expand({
				values: { AUTH: `Bearer ${ref("KEY")}`, PLAIN: "x", TWICE: ref("KEY") },
			}),
		).toEqual({
			ok: true,
			values: ["k1"],
			env: { AUTH: "Bearer k1", PLAIN: "x", TWICE: "k1" },
		});
		expect(ports.facts.uses).toHaveLength(1);
	});

	test("a reference with no value expands nothing and is no use", async () => {
		const { ports, expand } = wired();
		ports.env.KEY = "k1";
		expect(
			await expand({ values: { A: ref("KEY"), B: ref("MISSING") } }),
		).toEqual({ ok: false, missing: ["MISSING"] });
		expect(ports.facts.uses).toEqual([]);
	});
});
