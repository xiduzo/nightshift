import { describe, expect, test } from "bun:test";
import { hostRouter } from "@nightshift/devices";
import { type AnyProcedure, isProcedure } from "@orpc/server";

import { appRouter } from "./router";

/**
 * A Device calls its Host through the peer protocol that
 * `@nightshift/devices` writes as a contract and implements once
 * (`hostRouter`, with the contract's shape, schemas and Device key
 * permissions). The API mounts that router: each procedure is served at
 * the contract's path, with the contract's schemas and Device key
 * permission. Older Devices call these paths: a move or a rename breaks
 * their link.
 */
describe("the peer protocol", () => {
	test("is served at the contract's paths, with its schemas and key permissions", () => {
		const groups = appRouter as unknown as Record<
			string,
			Record<string, unknown>
		>;
		let served = 0;
		for (const [group, procedures] of Object.entries(hostRouter)) {
			for (const [name, implemented] of Object.entries(procedures)) {
				const procedure = groups[group]?.[name];
				expect(isProcedure(procedure), `${group}.${name}`).toBe(true);
				const { inputSchema, outputSchema, meta } = (procedure as AnyProcedure)[
					"~orpc"
				];
				expect(inputSchema).toBe(implemented["~orpc"].inputSchema);
				expect(outputSchema).toBe(implemented["~orpc"].outputSchema);
				expect(meta).toEqual(implemented["~orpc"].meta);
				served++;
			}
		}
		// 24 before `sync.commands`, 25 before `sync.mergePersonal`, 26
		// before `link.leave` and 27 before `archive.knowledgePut` and
		// `archive.knowledgeGet`, 29 before the `leases` group (ADR 7), and
		// 32 before `sync.addProject`, 33 before the `secrets` group, 37
		// before the `projectSecrets` group and 42 before
		// `secrets.moveOnDevice` (ADR 13), 43 before `sync.setClones`, 44
		// before the `spaceSecrets` group (ADR 18) and 48 before
		// `sync.addWithoutFolder` (ADR 22), which an older Host lacks.
		expect(served).toBe(49);
	});
});
