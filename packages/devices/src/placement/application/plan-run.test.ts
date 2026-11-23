import { describe, expect, test } from "bun:test";
import { planRun } from "./plan-run";

describe("planRun", () => {
	test("binds the placement method", () => {
		const stub = { plan: () => "ok" } as never;
		expect(typeof planRun(stub)).toBe("function");
	});
});
