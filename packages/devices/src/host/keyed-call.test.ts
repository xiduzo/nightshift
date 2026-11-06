import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type DeviceKeyAccess, ROLE_REFUSAL } from "@nightshift/auth";
import { member, user } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { Refusal } from "@nightshift/refusal";
import { asDate } from "@nightshift/time";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { NOT_A_HOST } from "../contract";
import type { PairedDevice } from "../registry";
import { admission } from "./keyed-call";

/**
 * A keyed call is admitted once, before its procedure: the key rules of
 * the contract's meta, then this computer as a Host, then the Device as
 * paired here. What comes out is the Caller every procedure takes.
 */

let sandbox: Sandbox;
/** The owner of the sandbox: the owner of its Space. */
let ownerId: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	const [owner] = await sandbox.db.select().from(user);
	ownerId = owner?.id as string;
});
afterEach(() => sandbox.cleanup());

/** A Device paired here, of `ownerId` unless said. */
const paired = (facts: Partial<PairedDevice> = {}): PairedDevice => ({
	id: "laptop",
	name: "The laptop",
	platform: "test",
	ownerId,
	homeHost: "https://host.invalid",
	lastSeenAt: null,
	online: true,
	pairedAt: 0,
	revokedAt: null,
	...facts,
});

/** The laptop's key, of `ownerId` unless said. */
const keyOf = (facts: Partial<DeviceKeyAccess> = {}): DeviceKeyAccess => ({
	keyId: "key-laptop",
	deviceId: "laptop",
	personId: ownerId,
	permissions: { sync: ["pull", "push"] },
	...facts,
});

/** This Host's admission over a registry with one Device (or none), with "Be a Host" on unless said. */
function hostWith(device: PairedDevice | null, isHost = true) {
	return admission({
		db: sandbox.db,
		registry: { get: async (id) => (device?.id === id ? device : null) },
		isHost: () => isHost,
	});
}

/** What a call ends in: the ORPCError's code, the Refusal's kind, or null for an answer. */
async function endOf(promise: Promise<unknown>): Promise<string | null> {
	return promise.then(
		() => null,
		(error: unknown) => {
			if (error instanceof ORPCError) return error.code;
			if (error instanceof Refusal) return `refusal:${error.kind}`;
			throw error;
		},
	);
}

describe("the key rules of the contract's meta", () => {
	test("no key is UNAUTHORIZED, a key without the permission FORBIDDEN, and a procedure that names none refuses too", async () => {
		const admit = hostWith(paired());
		expect(await endOf(admit(null, "sync"))).toBe("UNAUTHORIZED");
		expect(await endOf(admit(keyOf(), "archive"))).toBe("FORBIDDEN");
		expect(await endOf(admit(keyOf(), undefined))).toBe("FORBIDDEN");
		expect(await endOf(admit(keyOf(), "sync"))).toBeNull();
	});
});

describe("this computer as a Host", () => {
	test("refuses in its own words while Be a Host is off, so the Device keeps its key", async () => {
		const admit = hostWith(paired(), false);
		const error = await admit(keyOf(), "sync").then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(Refusal);
		expect(error).toMatchObject({ kind: "unavailable", message: NOT_A_HOST });
	});

	test("takes a Device paired here with access as its Person's own, and no other", async () => {
		expect(await endOf(hostWith(null)(keyOf(), "sync"))).toBe("UNAUTHORIZED");
		expect(
			await endOf(hostWith(paired({ revokedAt: 5 }))(keyOf(), "sync")),
		).toBe("UNAUTHORIZED");
		expect(
			await endOf(hostWith(paired({ ownerId: "bob" }))(keyOf(), "sync")),
		).toBe("UNAUTHORIZED");
		expect(await endOf(hostWith(paired())(keyOf(), "sync"))).toBeNull();
	});
});

describe("the Caller", () => {
	test("is the key with its Device as paired, and its Person's roles from the member rows", async () => {
		const caller = await hostWith(paired())(keyOf(), "sync");
		expect(caller).toMatchObject({
			...keyOf(),
			device: { name: "The laptop", homeHost: "https://host.invalid" },
		});
		expect(await caller.spaces()).toContain(sandbox.spaceId);
		expect(await caller.roleIn(sandbox.spaceId)).toBe("owner");
		expect(await caller.member(sandbox.spaceId)).toBe(true);
		expect(await caller.member("space-none")).toBe(false);
		await expect(
			caller.may(sandbox.spaceId, { run: ["start"] }),
		).resolves.toBeUndefined();
	});

	test("refuses in the Device's code what the role does not allow, with the role refusal's words or the procedure's", async () => {
		await sandbox.db
			.insert(user)
			.values({ id: "viv", name: "Viv", email: "viv@example.invalid" });
		await sandbox.db.insert(member).values({
			id: "m-viv",
			organizationId: sandbox.spaceId,
			userId: "viv",
			role: "viewer",
			createdAt: asDate(),
		});
		const viewer = await hostWith(paired({ ownerId: "viv" }))(
			keyOf({ personId: "viv" }),
			"sync",
		);
		const refused = (promise: Promise<void>) =>
			promise.then(
				() => null,
				(e: unknown) => e,
			);
		expect(
			await refused(viewer.may(sandbox.spaceId, { run: ["start"] })),
		).toMatchObject({ code: "FORBIDDEN", message: ROLE_REFUSAL.message });
		expect(
			await refused(
				viewer.may(sandbox.spaceId, { offer: ["make"] }, "Not for a viewer."),
			),
		).toMatchObject({ code: "FORBIDDEN", message: "Not for a viewer." });
		// Not a Member: refused the same.
		expect(
			await refused(viewer.may("space-none", { run: ["start"] })),
		).toMatchObject({ code: "FORBIDDEN" });
	});

	test("reads a Space's role once per call: the next call sees a change", async () => {
		const admit = hostWith(paired());
		const first = await admit(keyOf(), "sync");
		expect(await first.roleIn(sandbox.spaceId)).toBe("owner");
		await sandbox.db
			.update(member)
			.set({ role: "viewer" })
			.where(eq(member.userId, ownerId));
		expect(await first.roleIn(sandbox.spaceId)).toBe("owner");
		await expect(
			first.may(sandbox.spaceId, { run: ["start"] }),
		).resolves.toBeUndefined();
		const next = await admit(keyOf(), "sync");
		expect(await next.roleIn(sandbox.spaceId)).toBe("viewer");
	});
});
