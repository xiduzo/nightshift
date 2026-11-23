import { describe, expect, test } from "bun:test";
import { listDevicesFor } from "./list-devices-for";

describe("listDevicesFor", () => {
	test("binds the placement method", () => {
		const stub = { devicesFor: () => "ok" } as never;
		expect(typeof listDevicesFor(stub)).toBe("function");
	});
});
