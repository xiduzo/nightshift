import { afterEach, describe, expect, test } from "bun:test";
import type { MoveStore } from "../../application/ports";

/**
 * The contract of `MoveStore`: one suite that the in-memory adapter and
 * the real one both pass. `make` gives a store on an empty Replica, and
 * the rows it starts from.
 */

export type MoveStoreSeed = {
	space(id: string): Promise<void>;
	project(row: {
		id: string;
		spaceId: string;
		remote: string | null;
	}): Promise<void>;
	run(row: {
		id: string;
		spaceId: string;
		projectId: string;
		walkerId: string;
	}): Promise<void>;
};

export type MoveStoreSubject = {
	moveStore: MoveStore;
	seed: MoveStoreSeed;
	close(): Promise<void>;
};

export function moveStoreContract(
	name: string,
	make: () => Promise<MoveStoreSubject>,
) {
	describe(`MoveStore (${name})`, () => {
		let subject: MoveStoreSubject | undefined;
		afterEach(async () => {
			await subject?.close();
			subject = undefined;
		});

		/** Spaces `from` and `to`. In `from`: `app` with two runs, one of them walked by `b`. */
		async function twoSpaces() {
			subject = await make();
			const { seed } = subject;
			await seed.space("from");
			await seed.space("to");
			await seed.project({ id: "app", spaceId: "from", remote: null });
			await seed.run({
				id: "r1",
				spaceId: "from",
				projectId: "app",
				walkerId: "a",
			});
			await seed.run({
				id: "r2",
				spaceId: "from",
				projectId: "app",
				walkerId: "b",
			});
			return subject.moveStore;
		}

		test("gives the runs of the Projects in a Space, or of one Walker only", async () => {
			const store = await twoSpaces();
			expect((await store.runIds("from", ["app"])).sort()).toEqual([
				"r1",
				"r2",
			]);
			expect(await store.runIds("from", ["app"], "b")).toEqual(["r2"]);
			expect(await store.runIds("to", ["app"])).toEqual([]);
			expect(await store.runIds("from", [])).toEqual([]);
		});

		test("gives the rows of the Projects by id, and none for an id it lacks", async () => {
			const store = await twoSpaces();
			const rows = await store.projectRows(["app", "gone"]);
			expect([...rows.keys()]).toEqual(["app"]);
			expect(rows.get("app")).toMatchObject({
				id: "app",
				spaceId: "from",
				remote: null,
			});
			expect((await store.projectRows([])).size).toBe(0);
		});

		test("a committed batch moves a Project and its runs to the other Space", async () => {
			const store = await twoSpaces();
			const batch = await store.batchOf({
				from: "from",
				to: "to",
				projectMap: { app: "app" },
			});
			expect(await store.runIds("to", ["app"])).toEqual([]);
			await store.commit([batch]);
			expect((await store.runIds("to", ["app"])).sort()).toEqual(["r1", "r2"]);
			expect((await store.projectRows(["app"])).get("app")?.spaceId).toBe("to");
		});

		test("with one Walker's runs, the runs another Walker walks stay", async () => {
			const store = await twoSpaces();
			await store.commit([
				await store.batchOf({
					from: "from",
					to: "to",
					projectMap: { app: "app" },
					runsOf: "b",
				}),
			]);
			expect(await store.runIds("to", ["app"])).toEqual(["r2"]);
			expect(await store.runIds("from", ["app"])).toEqual(["r1"]);
		});

		test("a Project that maps onto one of the other Space gives it its runs, and its own row goes", async () => {
			const store = await twoSpaces();
			await subject?.seed.project({
				id: "app-there",
				spaceId: "to",
				remote: null,
			});
			await store.commit([
				await store.batchOf({
					from: "from",
					to: "to",
					projectMap: { app: "app-there" },
				}),
			]);
			expect((await store.runIds("to", ["app-there"])).sort()).toEqual([
				"r1",
				"r2",
			]);
			expect([
				...(await store.projectRows(["app", "app-there"])).keys(),
			]).toEqual(["app-there"]);
		});

		test("refuses a Project that is not in the Space it moves from, and changes nothing", async () => {
			const store = await twoSpaces();
			await expect(
				store.batchOf({ from: "to", to: "from", projectMap: { app: "app" } }),
			).rejects.toThrow("The project app is not in the Space to.");
			await expect(
				store.batchOf({
					from: "from",
					to: "to",
					projectMap: { app: "other" },
					runsOf: "a",
				}),
			).rejects.toThrow(
				"A move of one Walker's runs keeps every Project's id.",
			);
			expect((await store.runIds("from", ["app"])).sort()).toEqual([
				"r1",
				"r2",
			]);
		});

		test("no batches: nothing runs", async () => {
			const store = await twoSpaces();
			await store.commit([]);
			await store.commit([[]]);
			expect((await store.runIds("from", ["app"])).sort()).toEqual([
				"r1",
				"r2",
			]);
		});

		test("knows whether a Space's row, or a Project or run of it, is here", async () => {
			const store = await twoSpaces();
			expect(await store.spaceExists("from")).toBe(true);
			expect(await store.spaceExists("gone")).toBe(false);
			expect(await store.holdsRows("from")).toBe(true);
			expect(await store.holdsRows("to")).toBe(false);
		});

		test("forgetting the rows of a Space keeps its Projects and runs, and runs again safely", async () => {
			const store = await twoSpaces();
			await store.forgetRows("from");
			await store.forgetRows("from");
			expect(await store.holdsRows("from")).toBe(true);
			expect((await store.runIds("from", ["app"])).sort()).toEqual([
				"r1",
				"r2",
			]);
		});
	});
}
