import { describe, expect, spyOn, test } from "bun:test";
import { HostUnreachableError } from "@nightshift/engine";
import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import { createRouterClient, ORPCError } from "@orpc/server";

import { type HostPeerContext, hostRouter } from "./router";

/**
 * The errors a Device gets from its Host keep the codes older Devices
 * know: a refusal is a BAD_REQUEST with its words, and a FORBIDDEN or an
 * UNAUTHORIZED only ever means the Device key. A failure is plain words,
 * and its details stay in the Host's log.
 */

/** What `devices.reachable` ends in on a Host whose exchange throws `thrown`. */
async function errorOf(thrown: Error): Promise<ORPCError<string, unknown>> {
	const context = {
		deviceKey: {
			keyId: "key-1",
			deviceId: "device-1",
			personId: "person-1",
			permissions: { relay: ["use"] },
		},
		exchange: {
			reachable: async () => {
				throw thrown;
			},
		},
		devices: {},
		phones: {},
	} as unknown as HostPeerContext;
	const host = createRouterClient(hostRouter, { context });
	const error = await host.devices.reachable({ deviceId: "device-2" }).then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(ORPCError);
	return error as ORPCError<string, unknown>;
}

describe("the Host's errors on the wire", () => {
	test("a refusal is a BAD_REQUEST with its words, whatever its kind", async () => {
		for (const kind of ["forbidden", "not-found", "conflict"] as const) {
			const error = await errorOf(new Refusal(kind, "Words for people."));
			expect(error).toMatchObject({
				code: "BAD_REQUEST",
				message: "Words for people.",
			});
		}
	});

	test("a Host out of reach keeps its own code", async () => {
		const error = await errorOf(new HostUnreachableError());
		expect(error).toMatchObject({ code: "HOST_UNREACHABLE", status: 503 });
	});

	test("a failure is plain words, and the Host logs its details", async () => {
		const failure = new TypeError("Cannot read properties of undefined");
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const error = await errorOf(failure);
			expect(error).toMatchObject({
				code: "INTERNAL_SERVER_ERROR",
				message: FAILURE_MESSAGE,
			});
			expect(logged).toHaveBeenCalledWith(
				"[host] devices.reachable failed:",
				failure,
			);
		} finally {
			logged.mockRestore();
		}
	});
});
