import { describe, expect, test } from "bun:test";
import { suggestField } from "./suggest-field";

describe("suggestField", () => {
	test("binds to the session port", () => {
		const run = suggestField({
			sessions: {
				runReport: async function* () {},
			},
			readProjectFacts: async () => ({
				packageManager: null,
				scripts: {},
				taskFiles: [],
			}),
		});
		expect(typeof run).toBe("function");
	});
});
