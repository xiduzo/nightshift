import { describe, expect, test } from "bun:test";
import { mergePersonal } from "./merge-personal";

describe("mergePersonal", () => {
	test("calls membership.merge", async () => {
		const run = mergePersonal({
			merge: async () => ({
				state: "pushed",
				projects: 1,
				runs: 0,
				backup: "/tmp/b.db",
			}),
		});
		expect(await run()).toMatchObject({ state: "pushed", projects: 1 });
	});
});
