import { describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { NO_ACCESS, NO_PERMISSION, ROLE_WORDS } from "../domain/words";
import { admitKeyedCall } from "./admit-keyed-call";

const keyOf = (fields: Partial<DeviceKeyAccess> = {}): DeviceKeyAccess => ({
	keyId: "key-laptop",
	deviceId: "laptop",
	personId: "person-ada",
	permissions: { sync: ["pull", "push"] },
	...fields,
});

describe("admitKeyedCall", () => {
	test("no key is UNAUTHORIZED, a key without the permission FORBIDDEN", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "laptop",
			name: "The laptop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		await expect(
			admitKeyedCall(p)({ key: null, need: "sync" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED", message: NO_ACCESS });
		await expect(
			admitKeyedCall(p)({ key: keyOf(), need: "archive" }),
		).rejects.toMatchObject({ code: "FORBIDDEN", message: NO_PERMISSION });
		expect(
			await admitKeyedCall(p)({ key: keyOf(), need: "sync" }),
		).toMatchObject({
			deviceId: "laptop",
			device: { name: "The laptop" },
		});
	});

	test("a revoked Device or another Person's is UNAUTHORIZED", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "laptop",
			name: "The laptop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: 5,
		});
		await expect(
			admitKeyedCall(p)({ key: keyOf(), need: "sync" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	test("Caller.may refuses a viewer in the role words, or the procedure's", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "laptop",
			name: "The laptop",
			platform: "test",
			ownerId: "viv",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		p.roles.roles.set("space-1", "viewer");
		const caller = await admitKeyedCall(p)({
			key: keyOf({ personId: "viv" }),
			need: "sync",
		});
		await expect(
			caller.may("space-1", { run: ["start"] }),
		).rejects.toMatchObject({ code: "FORBIDDEN", message: ROLE_WORDS });
		await expect(
			caller.may("space-1", { offer: ["make"] }, "Not for a viewer."),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Not for a viewer.",
		});
	});
});
