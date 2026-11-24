import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { PROTOCOL_VERSION } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import { type HostClient, hostContract } from "../../contract";
import { type HostReplica, hostInMemory } from "../../testing/host-in-memory";

/**
 * A Device of another version at a Host (ADR 45), over the Host's own
 * router: nothing of the link opens, and nothing it has is lost.
 */

let a: Sandbox;
let host: HostReplica;
let key: DeviceKeyAccess;
let version: number;

beforeEach(async () => {
	version = PROTOCOL_VERSION;
	a = await createSandbox();
	host = await hostInMemory(a, { deviceVersion: () => version });
	key = await host.join("device-b", "B");
});

afterEach(() => a.cleanup());

type Call = (input?: unknown) => Promise<unknown>;

/** Every procedure of the contract that needs a key, as the Device calls it. */
function keyedCalls(client: HostClient): [string, Call][] {
	const groups = client as unknown as Record<string, Record<string, Call>>;
	return Object.entries(hostContract)
		.filter(([group]) => group !== "pairing")
		.flatMap(([group, procedures]) =>
			Object.keys(procedures).map((name): [string, Call] => [
				`${group}.${name}`,
				async (input) => {
					const answer = await groups[group]?.[name]?.(input);
					// A stream answers at its first event.
					if (typeof answer === "object" && answer !== null) {
						const events = answer as Partial<AsyncIterable<unknown>>;
						await events[Symbol.asyncIterator]?.().next();
					}
					return answer;
				},
			]),
		);
}

const failed = async (call: Promise<unknown>) =>
	call.then(
		() => null,
		(error: unknown) => error,
	);

describe("a Device of another version", () => {
	for (const said of [0, PROTOCOL_VERSION + 1]) {
		test(`that says ${said} is refused at every procedure, before its input is read`, async () => {
			version = said;
			const calls = keyedCalls(host.memory.client(key));
			expect(calls.length).toBeGreaterThan(45);
			for (const [path, call] of calls) {
				const error = await failed(call({ not: "its input" }));
				expect(error, path).toBeInstanceOf(ORPCError);
				expect(error, path).toMatchObject({
					code: "HOST_UNREACHABLE",
					status: 503,
					data: { device: said === 0 ? "older" : "newer" },
				});
			}
			// It is not online, and its access is as it was.
			expect(await host.host.devices.get("device-b")).toMatchObject({
				online: false,
				revokedAt: null,
			});
			version = PROTOCOL_VERSION;
			expect(await host.memory.client(key).link.hello()).toMatchObject({
				deviceId: "device-b",
				version: PROTOCOL_VERSION,
			});
		});
	}

	test("a caller without a key hears nothing of the version, whatever it says", async () => {
		for (version of [0, PROTOCOL_VERSION, PROTOCOL_VERSION + 1]) {
			const error = await failed(host.memory.client(() => null).link.hello());
			expect(error).toMatchObject({ code: "UNAUTHORIZED" });
			expect((error as ORPCError<string, unknown>).data).toBeUndefined();
		}
	});
});

/**
 * How a Device of main at bf7ae5821 (2026-11-24, before the number) reads an
 * answer of its Host: `isRefusal` of `links/link.ts` and `fromHost` of
 * `links/from-host.ts`, as they are there.
 */
const main = {
	/** True ends its link for good, and deletes its key. */
	revokes: (error: unknown) =>
		error instanceof ORPCError &&
		(error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN"),
	/** What a run, a lease, a push of rows reads. `unreachable`: it waits. */
	reads(error: unknown): string {
		if (!(error instanceof ORPCError)) return "as it is";
		if (error.code === "HOST_UNREACHABLE") return "unreachable";
		if (error.code === "NOT_FOUND" || error.status === 404) return "older host";
		const kinds: Record<string, string> = {
			BAD_REQUEST: "invalid",
			FORBIDDEN: "forbidden",
			CONFLICT: "conflict",
		};
		if (error.code === "UNAUTHORIZED") return "not paired";
		return kinds[error.code] ?? "failure";
	},
};

describe("a Device from before the number", () => {
	test("reads every refusal as a Host it cannot reach now: no call revokes it, and each one waits", async () => {
		version = 0;
		for (const [path, call] of keyedCalls(host.memory.client(key))) {
			const error = await failed(call({}));
			expect(main.revokes(error), path).toBe(false);
			expect(main.reads(error), path).toBe("unreachable");
		}
	});
});
