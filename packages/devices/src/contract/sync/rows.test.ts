import { describe, expect, test } from "bun:test";
import { runRowsSchema } from "./rows";

describe("the rows of runs on the wire", () => {
	test("a run has each field of its row", () => {
		const run = {
			id: "run-1",
			spaceId: "space",
			projectId: "project",
			flowName: "build",
			flow: "{}",
			bodyFlows: "{}",
			flowRevision: null,
			bodyFlowRevisions: "{}",
			title: "build",
			worktreePath: "/work/run-1",
			branch: "nightshift/run-1",
			baseRef: "main",
			walkerId: "device",
			startedBy: null,
			deviceId: null,
			placements: null,
			deviceNames: null,
			fallbacks: null,
			createdAt: 1,
		};
		const accepts = (row: object) =>
			runRowsSchema.safeParse({
				runs: [row],
				steps: [],
				sessions: [],
				events: [],
			}).success;
		expect(accepts(run)).toBe(true);
		for (const field of Object.keys(run)) {
			const { [field as keyof typeof run]: _, ...without } = run;
			expect(accepts(without), field).toBe(false);
		}
	});
});
