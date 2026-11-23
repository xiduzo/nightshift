import { describe, expect, test } from "bun:test";
import { listPlacements } from "./list-placements";

describe("listPlacements", () => {
	test("binds the placement method", () => {
		const stub = { placements: () => "ok" } as never;
		expect(typeof listPlacements(stub)).toBe("function");
	});
});
