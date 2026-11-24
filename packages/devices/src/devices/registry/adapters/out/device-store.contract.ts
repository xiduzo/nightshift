import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RowBatch } from "@nightshift/engine";
import type { DeviceStore } from "../../application/ports";

/** One adapter of `DeviceStore` to test, on a Replica with no `device` row. */
export type DeviceStoreUnderTest = {
	deviceStore: DeviceStore;
	/** Runs a batch of the store's statements, as the engine's log runs `before`. */
	run(batch: RowBatch): Promise<void>;
	/** The engine's statements of a batch: none here. */
	engine: RowBatch;
	/** Adds a Command whose Walker is `walkerId`. */
	addCommand(id: string, walkerId: string): Promise<void>;
	/** The Walker of a Command. */
	commandWalker(id: string): Promise<string | null>;
	close(): Promise<void>;
};

const ada = "person-ada";
const pairing = {
	id: "device-b",
	name: "MacBook",
	platform: "darwin",
	ownerId: ada,
	homeHost: "https://host.example",
};

/**
 * What every adapter of `DeviceStore` does.
 * `device-store.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function deviceStoreContract(
	name: string,
	make: () => Promise<DeviceStoreUnderTest>,
): void {
	describe(`DeviceStore contract: ${name}`, () => {
		let under: DeviceStoreUnderTest;
		let store: DeviceStore;
		beforeEach(async () => {
			under = await make();
			store = under.deviceStore;
		});
		afterEach(async () => {
			await under.close();
		});

		test("this computer's row: one, made once, with its facts and owner", async () => {
			expect(await store.self()).toBeNull();
			expect(await store.selfId()).toBeNull();
			expect(await store.selfOwnerId()).toBeNull();
			await store.addSelf({ id: "self-1", name: "", platform: "" });
			await store.addSelf({ id: "self-2", name: "x", platform: "x" });
			expect(await store.selfId()).toBe("self-1");
			await store.setFacts("self-1", { name: "studio", platform: "linux" });
			await store.setFacts("self-1", { name: "studio 2" });
			await store.setOwner("self-1", ada);
			const self = await store.self();
			expect(self).toMatchObject({
				id: "self-1",
				name: "studio 2",
				platform: "linux",
				ownerId: ada,
				self: true,
			});
			expect(await store.selfOwnerId()).toBe(ada);
			expect(await store.paired("self-1")).toBeNull();
		});

		test("a pairing is a statement; it lands when its batch runs, and again keeps one row", async () => {
			const batch = store.joinRows({ ...pairing, machine: "m-1" });
			expect(await store.paired(pairing.id)).toBeNull();
			await under.run(batch);
			// The owner of a paired Device is not the owner of this computer.
			expect(await store.selfOwnerId()).toBeNull();
			expect(await store.paired(pairing.id)).toMatchObject({
				...pairing,
				machine: "m-1",
				self: false,
				revokedAt: null,
			});
			await under.run(store.revokeRows(pairing.id, 5_000));
			expect((await store.paired(pairing.id))?.revokedAt).toBe(5_000);
			await under.run(store.joinRows({ ...pairing, name: "MacBook 2" }));
			expect(await store.paired(pairing.id)).toMatchObject({
				name: "MacBook 2",
				machine: "m-1",
				revokedAt: null,
			});
			expect(await store.ownedBy(ada)).toHaveLength(1);
			expect(await store.pairedOwners()).toEqual([
				{ id: pairing.id, ownerId: ada },
			]);
		});

		test("what a Device says of itself; no fingerprint keeps the one it has", async () => {
			await under.run(store.joinRows({ ...pairing, machine: "m-1" }));
			await store.describe(pairing.id, {
				name: "Air",
				dev: false,
				machine: undefined,
			});
			expect(await store.paired(pairing.id)).toMatchObject({
				name: "Air",
				machine: "m-1",
			});
			await store.describe(pairing.id, {
				name: "Air",
				dev: true,
				machine: null,
			});
			expect(await store.paired(pairing.id)).toMatchObject({
				dev: true,
				machine: null,
			});
		});

		test("the same computer: access first, then seen last; never the one that asks or a dev one", async () => {
			for (const id of ["d-1", "d-2", "d-3"]) {
				await under.run(store.joinRows({ ...pairing, id, machine: "m" }));
			}
			await store.markSeen("d-1", 10);
			await store.markSeen("d-2", 20);
			await under.run(store.revokeRows("d-2", 30));
			expect((await store.sameMachine(ada, "m", "d-3"))?.id).toBe("d-1");
			await under.run(store.revokeRows("d-1", 40));
			expect((await store.sameMachine(ada, "m", "d-3"))?.id).toBe("d-2");
			await store.describe("d-3", { name: "x", dev: true, machine: null });
			await under.run(store.joinRows({ ...pairing, id: "d-3", machine: "m" }));
			expect((await store.sameMachine(ada, "m", "d-1"))?.id).toBe("d-2");
			expect(await store.sameMachine("person-bo", "m", "d-1")).toBeNull();
			expect(await store.sameMachine(ada, "another", "d-3")).toBeNull();
			// This computer's own row never counts.
			await store.addSelf({ id: "self-1", name: "s", platform: "linux" });
			await store.setOwner("self-1", ada);
			await store.describe("self-1", {
				name: "s",
				dev: false,
				machine: "own",
			});
			expect(await store.sameMachine(ada, "own", "d-1")).toBeNull();
		});

		test("seen: only a paired row; its time and owner", async () => {
			await store.addSelf({ id: "self-1", name: "s", platform: "linux" });
			expect(await store.markSeen("self-1", 10)).toBeNull();
			expect(await store.markSeen("nobody", 10)).toBeNull();
			await under.run(store.joinRows(pairing));
			expect(await store.markSeen(pairing.id, 10)).toEqual({
				id: pairing.id,
				ownerId: ada,
			});
			expect((await store.paired(pairing.id))?.lastSeenAt).toBe(10);
		});

		test("names, the known rows and the Persons of a home Host", async () => {
			await store.addSelf({ id: "self-1", name: "studio", platform: "linux" });
			await under.run(store.joinRows(pairing));
			await under.run(
				store.joinRows({
					...pairing,
					id: "d-guest",
					ownerId: "person-bo",
					homeHost: null,
				}),
			);
			await under.run(
				store.joinRows({ ...pairing, id: "d-gone", ownerId: "person-cy" }),
			);
			await under.run(store.revokeRows("d-gone", 1));
			await under.run(store.joinRows({ ...pairing, id: "d-second" }));
			expect(await store.names(["self-1", pairing.id, "nobody"])).toEqual(
				new Map([
					["self-1", "studio"],
					[pairing.id, "MacBook"],
				]),
			);
			const known = await store.known();
			expect(known.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
				{ id: "d-guest", name: "MacBook", ownerId: "person-bo" },
				{ id: "d-second", name: "MacBook", ownerId: ada },
				{ id: pairing.id, name: "MacBook", ownerId: ada },
				{ id: "self-1", name: "studio", ownerId: null },
			]);
			expect(await store.homePersons()).toEqual([ada]);
		});

		test("forget removes a paired row, never this computer's", async () => {
			await store.addSelf({ id: "self-1", name: "s", platform: "linux" });
			await under.run(store.joinRows(pairing));
			await store.forget(pairing.id, under.engine);
			await store.forget("self-1", under.engine);
			expect(await store.paired(pairing.id)).toBeNull();
			expect(await store.selfId()).toBe("self-1");
		});

		test("adopt: the row takes the new id with its facts, and the Commands follow", async () => {
			await store.addSelf({ id: "old", name: "studio", platform: "linux" });
			await store.setOwner("old", ada);
			await under.addCommand("c-1", "old");
			const row = await store.self();
			if (!row) throw new Error("no row");
			await store.adopt({ row, to: "new", engine: under.engine });
			expect(await store.self()).toMatchObject({
				id: "new",
				name: "studio",
				ownerId: ada,
				self: true,
			});
			expect(await store.names(["old"])).toEqual(new Map());
			expect(await under.commandWalker("c-1")).toBe("new");
		});
	});
}
