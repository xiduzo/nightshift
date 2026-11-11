/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { HOURS } from "./notification-choices";

describe("the choices of Settings", () => {
	test("offers every hour of the day", () => {
		expect(HOURS).toHaveLength(24);
		expect(HOURS[0]).toBe("00:00");
		expect(HOURS[23]).toBe("23:00");
	});
});
