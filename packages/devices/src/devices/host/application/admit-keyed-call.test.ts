import { describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { PROTOCOL_VERSION } from "@nightshift/refusal";
import { NOT_A_HOST } from "../../../contract";
import type { PairedDevice } from "../../registry";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { NO_ACCESS, NO_PERMISSION } from "../domain/words";
import { admitKeyedCall } from "./admit-keyed-call";

const keyOf = (fields: Partial<DeviceKeyAccess> = {}): DeviceKeyAccess => ({
	keyId: "key-laptop",
	deviceId: "laptop",
	personId: "person-ada",
	permissions: { sync: ["pull", "push"] },
	...fields,
});

const laptop = (fields: Partial<PairedDevice> = {}): PairedDevice => ({
	id: "laptop",
	name: "The laptop",
	platform: "test",
	ownerId: "person-ada",
	homeHost: "https://studio.invalid",
	lastSeenAt: null,
	online: true,
	pairedAt: 0,
	revokedAt: null,
	...fields,
});

describe("admitKeyedCall", () => {
	test("no key is UNAUTHORIZED, a key without the permission FORBIDDEN", async () => {
		const p = inMemoryHostPorts();
		p.registry.put(laptop());
		await expect(
			admitKeyedCall(p)({ key: null, need: "sync", version: PROTOCOL_VERSION }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED", message: NO_ACCESS });
		await expect(
			admitKeyedCall(p)({
				key: keyOf(),
				need: "archive",
				version: PROTOCOL_VERSION,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN", message: NO_PERMISSION });
		expect(
			await admitKeyedCall(p)({
				key: keyOf(),
				need: "sync",
				version: PROTOCOL_VERSION,
			}),
		).toMatchObject({
			deviceId: "laptop",
			device: { name: "The laptop" },
		});
	});

	test("a procedure that names no permission refuses, and so does a computer that is no Host", async () => {
		const p = inMemoryHostPorts();
		p.registry.put(laptop());
		await expect(
			admitKeyedCall(p)({
				key: keyOf(),
				need: undefined,
				version: PROTOCOL_VERSION,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		p.settings.enabled = false;
		await expect(
			admitKeyedCall(p)({
				key: keyOf(),
				need: "sync",
				version: PROTOCOL_VERSION,
			}),
		).rejects.toMatchObject({ kind: "unavailable", message: NOT_A_HOST });
	});

	test("a Device that is not paired here, revoked or another Person's is UNAUTHORIZED", async () => {
		const p = inMemoryHostPorts();
		await expect(
			admitKeyedCall(p)({
				key: keyOf(),
				need: "sync",
				version: PROTOCOL_VERSION,
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		for (const fields of [{ revokedAt: 5 }, { ownerId: "person-bob" }]) {
			p.registry.put(laptop(fields));
			await expect(
				admitKeyedCall(p)({
					key: keyOf(),
					need: "sync",
					version: PROTOCOL_VERSION,
				}),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		}
	});

	test("a Device of another version waits: never UNAUTHORIZED or FORBIDDEN, and remembered for its owner", async () => {
		const p = inMemoryHostPorts();
		p.registry.put(laptop());
		const admit = (version: number | null) =>
			admitKeyedCall(p)({ key: keyOf(), need: "sync", version });
		for (const [version, words] of [
			[null, "older"],
			[PROTOCOL_VERSION - 1, "older"],
			[PROTOCOL_VERSION + 1, "newer"],
		] as const) {
			await expect(admit(version)).rejects.toMatchObject({
				code: "HOST_UNREACHABLE",
				message: words,
			});
			expect(p.versions.of("laptop")).toBe(words);
		}
		await admit(PROTOCOL_VERSION);
		expect(p.versions.of("laptop")).toBeNull();
	});

	test("the version of a caller without access counts for nothing: who may act comes first", async () => {
		const p = inMemoryHostPorts();
		p.registry.put(laptop());
		const admit = (request: {
			key: DeviceKeyAccess | null;
			need?: "sync" | "archive";
		}) =>
			admitKeyedCall(p)({
				key: request.key,
				need: request.need ?? "sync",
				version: null,
			});
		await expect(admit({ key: null })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		await expect(
			admit({ key: keyOf(), need: "archive" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		p.settings.enabled = false;
		await expect(admit({ key: keyOf() })).rejects.toMatchObject({
			message: NOT_A_HOST,
		});
		p.settings.enabled = true;
		p.registry.put(laptop({ revokedAt: 5 }));
		await expect(admit({ key: keyOf() })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(p.versions.of("laptop")).toBeNull();
	});

	test("Caller.may refuses a viewer in the role words, or the procedure's", async () => {
		const p = inMemoryHostPorts();
		p.registry.put(laptop({ ownerId: "viv" }));
		p.roles.roles.set("space-1", "viewer");
		const caller = await admitKeyedCall(p)({
			key: keyOf({ personId: "viv" }),
			need: "sync",
			version: PROTOCOL_VERSION,
		});
		await expect(
			caller.may("space-1", { run: ["start"] }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Your role in this Space does not allow this.",
		});
		await expect(
			caller.may("space-1", { offer: ["make"] }, "Not for a viewer."),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Not for a viewer.",
		});
		// Not a Member: refused the same.
		await expect(
			caller.may("space-none", { run: ["start"] }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(await caller.member("space-none")).toBe(false);
	});

	test("reads a Space's role once per call: the next call sees a change", async () => {
		const p = inMemoryHostPorts();
		p.registry.put(laptop());
		p.roles.roles.set("space-1", "owner");
		const admit = () =>
			admitKeyedCall(p)({
				key: keyOf(),
				need: "sync",
				version: PROTOCOL_VERSION,
			});
		const first = await admit();
		expect(await first.roleIn("space-1")).toBe("owner");
		p.roles.roles.set("space-1", "viewer");
		expect(await first.roleIn("space-1")).toBe("owner");
		expect(await (await admit()).roleIn("space-1")).toBe("viewer");
	});
});
