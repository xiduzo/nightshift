import { describe, expect, test } from "bun:test";
import { finishedShare } from "./index";

describe("finishedShare", () => {
	test("rounds to whole percent", () => {
		expect(finishedShare(2, 3)).toBe(67);
		expect(finishedShare(3, 3)).toBe(100);
	});
	test("no ended runs has no share", () => {
		expect(finishedShare(0, 0)).toBeNull();
	});
});
