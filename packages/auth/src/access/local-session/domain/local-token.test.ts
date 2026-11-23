import { describe, expect, test } from "bun:test";
import { createTokenCell } from "./local-token";

describe("createTokenCell", () => {
	test("gives the token while it has not expired", () => {
		const cell = createTokenCell();
		expect(cell.live(0)).toBeNull();
		expect(cell.keep({ token: "t-1", expiresAt: 10 })).toBe("t-1");
		expect(cell.live(9)).toBe("t-1");
		expect(cell.live(10)).toBeNull();
	});

	test("forgets the token of a session that ended", () => {
		const cell = createTokenCell();
		cell.keep({ token: "t-1", expiresAt: 10 });
		cell.forget();
		expect(cell.live(0)).toBeNull();
	});
});
