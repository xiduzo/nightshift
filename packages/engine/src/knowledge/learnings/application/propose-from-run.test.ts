import { describe, expect, test } from "bun:test";
import { inMemoryFolderHolds } from "../adapters/out/in-memory-neighbours";
import { proposeFromRun } from "./propose-from-run";
import type { ProposeLearnings } from "./propose-learnings";

/** The use case proposeFromRun, on in-memory adapters. */

function setup() {
	const holds = inMemoryFolderHolds();
	const proposed: ProposeLearnings[] = [];
	const propose = async (request: ProposeLearnings) => {
		holds.log.push("propose");
		proposed.push(request);
	};
	return { holds, proposed, fromRun: proposeFromRun({ holds, propose }) };
}

describe("proposeFromRun", () => {
	test("holds the folder around the proposal, in the run's own file", async () => {
		const { holds, proposed, fromRun } = setup();
		await fromRun({ projectId: "p1", runId: "run-1", notes: ["One."] });
		expect(holds.log).toEqual(["hold p1", "propose", "done p1"]);
		expect(proposed).toEqual([
			{ projectId: "p1", step: { runId: "run-1" }, notes: ["One."], by: "run" },
		]);
	});

	test("no note: nothing is written, and the folder is not held", async () => {
		const { holds, proposed, fromRun } = setup();
		await fromRun({ projectId: "p1", runId: "run-1", notes: [] });
		expect(holds.log).toEqual([]);
		expect(proposed).toEqual([]);
	});
});
