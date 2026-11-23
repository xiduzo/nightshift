import { describe, expect, test } from "bun:test";
import { mergePending } from "./merge-pending";

describe("mergePending", () => {
	test("calls membership.pending", async () => {
		const pending = {
			pending: true,
			state: null,
			hostName: "Host",
			blocked: null,
		} as const;
		const run = mergePending({
			pending: async () => pending,
		});
		expect(await run()).toEqual(pending);
	});
});
