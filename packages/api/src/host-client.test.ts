import { describe, expect, test } from "bun:test";
import { type HostClient, hostContract } from "@nightshift/devices";
import { type AnyProcedure, isProcedure } from "@orpc/server";

import { type AppRouterClient, appRouter } from "./router";

/**
 * A Device calls its Host through `hostContract`, the peer protocol that
 * `@nightshift/devices` writes and implements (`hostRouter`). The API
 * mounts that router: each procedure is served at the contract's path,
 * with the contract's schemas and Device key permission. Older Devices
 * call these paths: a move or a rename breaks their link.
 */
const fits = (client: AppRouterClient): HostClient => client;

describe("the peer protocol", () => {
	test("is served at the contract's paths, with its schemas and key permissions", () => {
		const groups = appRouter as unknown as Record<
			string,
			Record<string, unknown>
		>;
		let served = 0;
		for (const [group, procedures] of Object.entries(hostContract)) {
			for (const [name, contract] of Object.entries(procedures)) {
				const procedure = groups[group]?.[name];
				expect(isProcedure(procedure), `${group}.${name}`).toBe(true);
				const { inputSchema, outputSchema, meta } = (procedure as AnyProcedure)[
					"~orpc"
				];
				expect(inputSchema).toBe(contract["~orpc"].inputSchema);
				expect(outputSchema).toBe(contract["~orpc"].outputSchema);
				expect(meta).toEqual(contract["~orpc"].meta);
				served++;
			}
		}
		// 24 before `sync.commands`, 25 before `sync.mergePersonal` and 26
		// before `link.leave`, which an older Host lacks.
		expect(served).toBe(27);
	});

	test("the router's client is a HostClient", () => {
		expect(typeof fits).toBe("function");
	});
});
