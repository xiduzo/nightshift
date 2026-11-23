import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";

import {
	AGENT_BLOCKED,
	DECIDER_BLOCKED,
	refuseBlocked,
	setupBlock,
} from "./setup-place";

describe("where a guided setup may act", () => {
	const here = { container: false, platform: "darwin" };

	test("acts on this computer on macOS and Linux", () => {
		expect(setupBlock(true, here)).toBeNull();
		expect(
			setupBlock(true, { container: false, platform: "linux" }),
		).toBeNull();
	});

	test("blocks a request from elsewhere, a container, and Windows", () => {
		expect(setupBlock(false, here)).toBe("elsewhere");
		expect(setupBlock(true, { container: true, platform: "darwin" })).toBe(
			"container",
		);
		expect(setupBlock(true, { container: false, platform: "win32" })).toBe(
			"platform",
		);
	});

	test("refuses in the words of the setup that asked", () => {
		expect(() => refuseBlocked(false, here, AGENT_BLOCKED)).toThrow(
			new Refusal("forbidden", AGENT_BLOCKED.elsewhere),
		);
		expect(() =>
			refuseBlocked(
				true,
				{ container: true, platform: "darwin" },
				DECIDER_BLOCKED,
			),
		).toThrow(new Refusal("forbidden", DECIDER_BLOCKED.container));
	});
});
