import { describe, expect, test } from "bun:test";
import type { HostClient } from "@nightshift/devices";

import type { AppRouterClient } from "./router";

/**
 * A Device calls its Host through `HostClient`, the peer protocol as
 * `@nightshift/devices` declares it. The router must serve every one of
 * those procedures with those inputs and outputs: the type check fails
 * here when a procedure or its shape drifts.
 */
const fits = (client: AppRouterClient): HostClient => client;

describe("the peer protocol", () => {
	test("the router's client is a HostClient", () => {
		expect(typeof fits).toBe("function");
	});
});
