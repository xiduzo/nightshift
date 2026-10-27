import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type Flow,
	flowSchema,
	parsedFlows,
	type Schedule,
	singleAgentFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { FlowsOf, ProjectFlows } from "../flows/project-flows";

/** One adapter of `ProjectFlows` with a project it may read and save, and how to clean up after. */
export type ProjectFlowsSubject = {
	flows: ProjectFlows;
	of: FlowsOf;
	dispose?: () => Promise<void>;
};

const quick = (): Flow =>
	flowSchema.parse(
		singleAgentFlow({
			prompt: "Fix it",
			model: "sonnet",
			permissionMode: "acceptEdits",
		}),
	);

/** A draft with an error: a loop without a `max`. */
const unbounded = (): Flow => ({
	...quick(),
	edges: [{ id: "again", from: "agent", outcome: "fail", to: "agent" }],
});

const nightly: Schedule = {
	id: "nightly",
	flow: "quick",
	inputs: {},
	cron: "0 22 * * *",
	enabled: true,
};

async function refusal(promise: Promise<unknown>): Promise<Refusal> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error("Expected a refusal.");
}

/**
 * What every adapter of `ProjectFlows` does, as tests: the file adapter
 * and the document adapter run the same suite. `make` gives a fresh
 * project with no flows and no schedules for each test.
 */
export function projectFlowsContract(
	name: string,
	make: () => Promise<ProjectFlowsSubject>,
): void {
	describe(`ProjectFlows: ${name}`, () => {
		let subject: ProjectFlowsSubject;

		beforeEach(async () => {
			subject = await make();
		});

		afterEach(async () => {
			await subject.dispose?.();
		});

		test("a project without flows has none and no schedules", async () => {
			const { flows, of } = subject;
			expect((await flows.flows(of)).sources).toEqual({});
			expect(await flows.schedules(of)).toMatchObject({
				schedules: [],
				issues: [],
			});
		});

		test("a saved flow reads back by name, as the current version", async () => {
			const { flows, of } = subject;
			expect(await flows.save(of, "quick", quick())).toEqual([]);
			const set = await flows.flows(of);
			expect(Object.keys(set.sources)).toEqual(["quick"]);
			expect(parsedFlows(set.sources)).toEqual({ quick: quick() });
		});

		test("a draft with errors is saved, and the save returns its issues", async () => {
			const { flows, of } = subject;
			expect(await flows.save(of, "draft", unbounded())).toEqual([
				expect.objectContaining({ severity: "error", nodeId: "agent" }),
			]);
			expect(parsedFlows((await flows.flows(of)).sources)).toEqual({
				draft: unbounded(),
			});
		});

		test("a save replaces the flow of that name", async () => {
			const { flows, of } = subject;
			await flows.save(of, "quick", unbounded());
			await flows.save(of, "quick", quick());
			expect(parsedFlows((await flows.flows(of)).sources)).toEqual({
				quick: quick(),
			});
		});

		test("a save refuses a name that is not a flow name", async () => {
			const { flows, of } = subject;
			expect((await refusal(flows.save(of, "Not A Name", quick()))).kind).toBe(
				"invalid",
			);
		});

		test("a removed flow is gone; removing it again is not found", async () => {
			const { flows, of } = subject;
			await flows.save(of, "quick", quick());
			await flows.save(of, "other", quick());
			await flows.remove(of, "quick");
			expect(Object.keys((await flows.flows(of)).sources)).toEqual(["other"]);
			expect((await refusal(flows.remove(of, "quick"))).kind).toBe("not-found");
		});

		test("saved schedules read back, checked against the flows", async () => {
			const { flows, of } = subject;
			expect(await flows.saveSchedules(of, [nightly])).toEqual([
				expect.objectContaining({
					severity: "error",
					scheduleId: "nightly",
					message: 'The flow "quick" does not exist.',
				}),
			]);
			await flows.save(of, "quick", quick());
			expect(await flows.schedules(of)).toMatchObject({
				schedules: [nightly],
				issues: [],
			});
		});

		test("schedules read without the checks have no issues", async () => {
			const { flows, of } = subject;
			await flows.saveSchedules(of, [nightly]);
			expect(await flows.schedules(of, { validate: false })).toMatchObject({
				schedules: [nightly],
				issues: [],
			});
		});
	});
}
