import { describe, expect, test } from "bun:test";
import { moveRunTo } from "./move-run-to";

describe("moveRunTo", () => {
	test("binds the placement method", () => {
		const stub = { moveTo: () => "ok" } as never;
		expect(typeof moveRunTo(stub)).toBe("function");
	});
});
