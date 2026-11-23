import { describe, expect, test } from "bun:test";
import { previewMerge } from "./preview-merge";

describe("previewMerge", () => {
	test("calls membership.preview with the join list", async () => {
		const seen: { join?: readonly string[] }[] = [];
		const run = previewMerge({
			preview: async (input) => {
				seen.push(input);
				return { host: { id: "h", name: "Host" }, projects: [], runs: 0 };
			},
		});
		await run({ join: ["p1"] });
		expect(seen).toEqual([{ join: ["p1"] }]);
	});
});
