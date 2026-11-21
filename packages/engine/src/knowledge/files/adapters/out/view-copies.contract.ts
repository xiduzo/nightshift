import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import type { ViewCopies } from "../../application/ports";

/** One adapter of `ViewCopies` to test, a knowledge folder with `a.md` and `b/c.md`, and a file that went since the look (`gone.md`). */
export type ViewCopiesUnderTest = {
	viewCopies: ViewCopies;
	source: string;
	close(): Promise<void>;
};

/**
 * What every adapter of `ViewCopies` does.
 * `view-copies.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function viewCopiesContract(
	name: string,
	make: () => Promise<ViewCopiesUnderTest>,
): void {
	describe(`ViewCopies contract: ${name}`, () => {
		let under: ViewCopiesUnderTest;
		let views: ViewCopies;
		beforeEach(async () => {
			under = await make();
			views = under.viewCopies;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a new view is empty, and each view is its own", async () => {
			const one = await views.make();
			const two = await views.make();
			expect(one).not.toBe(two);
			expect((await views.scan(one)).files).toEqual([]);
			await views.remove(one);
			await views.remove(two);
		});

		test("a file copies with the time it last changed; one that went does not", async () => {
			const view = await views.make();
			const at = parseInstant("2026-01-02T00:00:00Z");
			expect(
				await views.copy(under.source, view, {
					path: "b/c.md",
					size: 5,
					changedAt: at,
				}),
			).toBe(true);
			expect(
				await views.copy(under.source, view, {
					path: "gone.md",
					size: 1,
					changedAt: at,
				}),
			).toBe(false);
			const look = await views.scan(view);
			expect(look.files.map((file) => file.path)).toEqual(["b/c.md"]);
			expect(look.file("b/c.md")?.changedAt).toBe(at);
			await views.remove(view);
		});

		test("a removed view is gone, and a second removal is fine", async () => {
			const view = await views.make();
			await views.copy(under.source, view, {
				path: "a.md",
				size: 3,
				changedAt: parseInstant("2026-01-01T00:00:00Z"),
			});
			await views.remove(view);
			await views.remove(view);
			expect((await views.scan(view)).files).toEqual([]);
		});
	});
}
