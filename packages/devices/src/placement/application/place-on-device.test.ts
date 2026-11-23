import { describe, expect, test } from "bun:test";
import { placeOnDevice } from "./place-on-device";

describe("placeOnDevice", () => {
	test("binds the placement method", () => {
		const stub = { deviceById: () => "ok" } as never;
		expect(typeof placeOnDevice(stub)).toBe("function");
	});
});
