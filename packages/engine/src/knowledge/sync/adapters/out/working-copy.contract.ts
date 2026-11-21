import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { WorkingCopy } from "../../application/ports";

/** One adapter of `WorkingCopy` to test. */
export type WorkingCopyUnderTest = {
	workingCopy: WorkingCopy;
	close(): Promise<void>;
};

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (content: Uint8Array | null) =>
	content === null ? null : new TextDecoder().decode(content);

/**
 * What every adapter of `WorkingCopy` does.
 * `working-copy.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function workingCopyContract(
	name: string,
	make: () => Promise<WorkingCopyUnderTest>,
): void {
	describe(`WorkingCopy contract: ${name}`, () => {
		let under: WorkingCopyUnderTest;
		let copy: WorkingCopy;
		beforeEach(async () => {
			under = await make();
			copy = under.workingCopy;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a project with no folder has no file, no state and an empty look", async () => {
			expect(await copy.exists("p1")).toBe(false);
			expect(await copy.known()).toEqual([]);
			expect(await copy.read("p1", "a.md")).toBeNull();
			expect(await copy.readState("p1")).toBeNull();
			expect((await copy.scan("p1")).files).toEqual([]);
		});

		test("a file written reads back, with its size, and the look finds it", async () => {
			await copy.ensure("p1");
			expect(await copy.exists("p1")).toBe(true);
			expect(await copy.known()).toEqual(["p1"]);
			const written = await copy.write("p1", "notes/a.md", bytes("# A\n"));
			expect(written?.size).toBe(4);
			expect(text(await copy.read("p1", "notes/a.md"))).toBe("# A\n");
			const look = await copy.scan("p1");
			expect(look.files.map((file) => file.path)).toEqual(["notes/a.md"]);
			expect(look.file("notes/a.md")?.changedAt).toBe(written?.mtimeMs);
			expect(await copy.inFolder("p1", "notes/a.md")).toBe(true);
		});

		test("the state of the last reconcile reads back, and the look leaves it out", async () => {
			await copy.ensure("p1");
			await copy.writeState("p1", '{"files":{},"unpushed":[]}');
			expect(await copy.readState("p1")).toBe('{"files":{},"unpushed":[]}');
			expect((await copy.scan("p1")).files).toEqual([]);
		});

		test("a removed file is gone", async () => {
			await copy.ensure("p1");
			await copy.write("p1", "notes/a.md", bytes("a"));
			await copy.remove("p1", "notes/a.md");
			expect(await copy.read("p1", "notes/a.md")).toBeNull();
			expect((await copy.scan("p1")).files).toEqual([]);
		});

		test("a move takes the folder to the other project's place", async () => {
			await copy.ensure("p1");
			await copy.write("p1", "a.md", bytes("a"));
			await copy.move("p1", "p2");
			expect(await copy.exists("p1")).toBe(false);
			expect(text(await copy.read("p2", "a.md"))).toBe("a");
		});
	});
}
