import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { myKitEntries } from "./my-kits";

/** A flow that runs each of `calls` with a Subflow, or none. */
function flow(description: string, ...calls: string[]): Flow {
	return {
		version: FLOW_VERSION,
		description,
		inputs: [],
		outputs: [],
		start: calls.length > 0 ? "call_0" : "",
		nodes: calls.map((called, index) => ({
			id: `call_${index}`,
			type: "call",
			position: { x: 0, y: 0 },
			flow: called,
			inputs: {},
		})),
		edges: [],
	};
}

const summarize = flow("Sums up a page. It keeps it short.");

describe("My kits", () => {
	test("this project's flows that another flow runs, the draft included", () => {
		const entries = myKitEntries({
			flowName: "daily",
			draft: flow("", "summarize"),
			flows: {
				summarize,
				notify: flow("Says what is new."),
				weekly: flow("", "notify"),
				broken: null,
				lonely: flow("Nobody runs it."),
			},
			others: [],
		});
		expect(entries.map((entry) => entry.key)).toEqual([
			"flow:notify",
			"flow:summarize",
		]);
		expect(entries[1]).toMatchObject({
			family: "compose",
			takes: "nothing",
			label: "summarize",
			blurb: "Sums up a page.",
			add: { kind: "kit", flow: "summarize" },
		});
		expect(entries[1]?.badge).toBeUndefined();
	});

	test("never the open flow, even when another flow runs it", () => {
		const entries = myKitEntries({
			flowName: "summarize",
			draft: summarize,
			flows: { daily: flow("", "summarize") },
			others: [],
		});
		expect(entries).toEqual([]);
	});

	test("then the other projects', with their name, copied on a pick", () => {
		const entries = myKitEntries({
			flowName: "daily",
			draft: flow(""),
			flows: { summarize },
			others: [
				{
					projectId: "p-z",
					project: "Zeta",
					flows: { digest: flow("Digests."), run: flow("", "digest") },
				},
				{
					projectId: "p-a",
					project: "Alpha",
					flows: {
						// The same as this project's: left out.
						summarize,
						fetch: flow("Fetches.", "summarize"),
						scan: flow("Scans."),
						report: flow("", "scan"),
					},
				},
			],
		});
		expect(entries.map((entry) => entry.key)).toEqual([
			"flow:p-a/scan",
			"flow:p-z/digest",
		]);
		expect(entries[0]).toMatchObject({
			label: "scan",
			badge: "Alpha",
			add: {
				kind: "kit",
				flow: "scan",
				from: { projectId: "p-a", project: "Alpha" },
			},
		});
	});

	test("another project's flow of the same name but other steps stays", () => {
		const entries = myKitEntries({
			flowName: "daily",
			draft: flow(""),
			flows: { summarize },
			others: [
				{
					projectId: "p-a",
					project: "Alpha",
					flows: {
						summarize: flow("Sums up a page in French."),
						run: flow("", "summarize"),
					},
				},
			],
		});
		expect(entries.map((entry) => entry.key)).toEqual(["flow:p-a/summarize"]);
	});

	test("none until this project's flows are read", () => {
		expect(
			myKitEntries({
				flowName: "daily",
				draft: flow("", "summarize"),
				flows: undefined,
				others: [
					{
						projectId: "p-a",
						project: "Alpha",
						flows: { scan: flow("Scans."), report: flow("", "scan") },
					},
				],
			}),
		).toEqual([]);
	});
});
