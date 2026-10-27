import { describe, expect, test } from "bun:test";
import { runRowsSchema } from "./rows";

describe("the rows of runs on the wire", () => {
	test("a run from a Device before Flow revisions reads with none", () => {
		const older = {
			id: "run-1",
			spaceId: "space",
			projectId: "project",
			flowName: "build",
			flow: "{}",
			bodyFlows: "{}",
			title: "build",
			worktreePath: "/work/run-1",
			branch: "nightshift/run-1",
			baseRef: "main",
			walkerId: "device-old",
			createdAt: 1,
		};
		const [run] = runRowsSchema.parse({
			runs: [older],
			steps: [],
			sessions: [],
			events: [],
		}).runs;
		expect(run).toMatchObject({ flowRevision: null, bodyFlowRevisions: "{}" });
	});
});
