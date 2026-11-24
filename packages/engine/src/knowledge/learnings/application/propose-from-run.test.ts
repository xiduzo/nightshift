import { describe, expect, test } from "bun:test";
import { inMemorySync } from "../../sync/adapters/out/in-memory-sync";
import { proposeFromRun } from "./propose-from-run";
import type { ProposeLearnings } from "./propose-learnings";

/** The use case proposeFromRun, on in-memory adapters. */

function setup() {
	const { reconciler: holds, holds: log } = inMemorySync();
	const proposed: ProposeLearnings[] = [];
	const propose = async (request: ProposeLearnings) => {
		log.push("propose");
		proposed.push(request);
	};
	return { log, proposed, fromRun: proposeFromRun({ holds, propose }) };
}

describe("proposeFromRun", () => {
	test("holds the folder around the proposal, in the run's own file", async () => {
		const { log, proposed, fromRun } = setup();
		await fromRun({ projectId: "p1", runId: "run-1", notes: ["One."] });
		expect(log).toEqual(["hold p1", "propose", "done p1"]);
		expect(proposed).toEqual([
			{ projectId: "p1", step: { runId: "run-1" }, notes: ["One."], by: "run" },
		]);
	});

	test("no note: nothing is written, and the folder is not held", async () => {
		const { log, proposed, fromRun } = setup();
		await fromRun({ projectId: "p1", runId: "run-1", notes: [] });
		expect(log).toEqual([]);
		expect(proposed).toEqual([]);
	});
});
