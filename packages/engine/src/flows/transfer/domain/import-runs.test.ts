import { describe, expect, test } from "bun:test";
import { createImportRuns } from "./import-runs";

describe("createImportRuns", () => {
	test("a second run of one Clone joins the first, and a run after it starts again", async () => {
		const runs = createImportRuns();
		let started = 0;
		let finish = () => {};
		const run = () => {
			started += 1;
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		};
		const first = runs.once("clone-1", run);
		const second = runs.once("clone-1", run);
		expect(second).toBe(first);
		expect(started).toBe(1);
		finish();
		await first;
		const third = runs.once("clone-1", run);
		expect(started).toBe(2);
		finish();
		await third;
	});
});
