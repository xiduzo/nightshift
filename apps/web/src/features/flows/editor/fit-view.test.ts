import { describe, expect, test } from "bun:test";
import { FIT_VIEW, fitViewOptions } from "./fit-view";

describe("fitViewOptions", () => {
	test("without a panel, the flow fits the whole canvas", () => {
		expect(fitViewOptions(1200, 0)).toBe(FIT_VIEW);
	});

	test("beside the chat, the flow keeps out from under it", () => {
		expect(fitViewOptions(1400, 392)).toEqual({
			maxZoom: 1,
			padding: { top: "15%", bottom: "15%", left: "10%", right: "416px" },
		});
	});

	test("a canvas too narrow for both, or not measured yet, fits as without a panel", () => {
		expect(fitViewOptions(600, 392)).toBe(FIT_VIEW);
		expect(fitViewOptions(0, 392)).toBe(FIT_VIEW);
	});
});
