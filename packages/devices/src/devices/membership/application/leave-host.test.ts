import { describe, expect, test } from "bun:test";
import { leaveHost } from "./leave-host";

describe("leaveHost", () => {
	test("calls membership.leave", async () => {
		const run = leaveHost({
			leave: async () => ({
				host: { id: "h", name: "Host" },
				told: true,
				split: null,
				waiting: null,
			}),
		});
		expect(await run()).toMatchObject({ told: true });
	});
});
