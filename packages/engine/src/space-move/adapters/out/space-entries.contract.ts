import { afterEach, describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import type { SpaceEntries } from "../../application/ports";
import type { ProjectRow } from "../../domain/move";

/**
 * The contract of `SpaceEntries`: one suite that the in-memory adapter and
 * the real one both pass. `make` gives the Space documents of the Spaces
 * `from`, `to` and `other`, all of them this Replica's to write.
 */

export type SpaceEntriesSubject = {
	spaceEntries: SpaceEntries;
	seed: {
		entry(spaceId: string, projectId: string, name: string): Promise<void>;
		clone(spaceId: string, projectId: string, deviceId: string): Promise<void>;
	};
	/** Removes the Space's own row, as the merge does before it forgets the Space. */
	dropSpace(spaceId: string): Promise<void>;
	/** A document as it is now: its entries by name, and its Clones. */
	read(spaceId: string): Promise<{
		projects: Record<string, string>;
		clones: string[];
	}>;
	close(): Promise<void>;
};

const row = (id: string, name: string): ProjectRow => ({
	id,
	spaceId: "from",
	name,
	remote: null,
	folder: true,
	createdAt: asDate(0),
	removedAt: null,
});

export function spaceEntriesContract(
	name: string,
	make: () => Promise<SpaceEntriesSubject>,
) {
	describe(`SpaceEntries (${name})`, () => {
		let subject: SpaceEntriesSubject | undefined;
		afterEach(async () => {
			await subject?.close();
			subject = undefined;
		});

		/** In `from`: `app` with Clones on `a` and `b`, and `site`. */
		async function seeded() {
			subject = await make();
			await subject.seed.entry("from", "app", "App");
			await subject.seed.entry("from", "site", "Site");
			await subject.seed.clone("from", "app", "a");
			await subject.seed.clone("from", "app", "b");
			return subject;
		}

		test("the Space a Project goes to gets its entry and its Clones, and the Space it left loses them", async () => {
			const { spaceEntries, read } = await seeded();
			await spaceEntries.move({
				from: "from",
				projects: { app: { spaceId: "to", projectId: "app" } },
				rows: new Map(),
			});
			expect(await read("to")).toEqual({
				projects: { app: "App" },
				clones: ["app/a", "app/b"],
			});
			expect(await read("from")).toEqual({
				projects: { site: "Site" },
				clones: [],
			});
		});

		test("an entry the document lacks comes from the Project's row", async () => {
			const { spaceEntries, read } = await seeded();
			await spaceEntries.move({
				from: "from",
				projects: { lost: { spaceId: "other", projectId: "lost" } },
				rows: new Map([["lost", row("lost", "Lost")]]),
			});
			expect((await read("other")).projects).toEqual({ lost: "Lost" });
		});

		test("a Project that maps onto one there keeps that one's entry and gets its Clones", async () => {
			const { spaceEntries, read, seed } = await seeded();
			await seed.entry("to", "app-there", "App there");
			await spaceEntries.move({
				from: "from",
				projects: { app: { spaceId: "to", projectId: "app-there" } },
				rows: new Map(),
			});
			expect(await read("to")).toEqual({
				projects: { "app-there": "App there" },
				clones: ["app-there/a", "app-there/b"],
			});
		});

		test("with one Device only, only its Clones go along, and the Space they left keeps everything", async () => {
			const { spaceEntries, read } = await seeded();
			await spaceEntries.move({
				from: "from",
				projects: { app: { spaceId: "to", projectId: "app" } },
				rows: new Map(),
				onlyDevice: "b",
			});
			expect(await read("to")).toEqual({
				projects: { app: "App" },
				clones: ["app/b"],
			});
			expect(await read("from")).toEqual({
				projects: { app: "App", site: "Site" },
				clones: ["app/a", "app/b"],
			});
		});

		test("forgetting a Space a move emptied, whose row is gone, removes its document", async () => {
			subject = await make();
			const { spaceEntries, read, dropSpace } = subject;
			await read("other");
			await dropSpace("other");
			await spaceEntries.forget("other");
			expect(await read("other")).toEqual({ projects: {}, clones: [] });
		});
	});
}
