import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, flowSchema } from "@nightshift/flows";
import { inMemorySourcesPorts } from "../adapters/out/in-memory-neighbours";
import { listFillingFlows } from "./list-filling-flows";
import { listKnowledgeSources } from "./list-knowledge-sources";

/** The use case listKnowledgeSources, on in-memory adapters. */

const all = { save: true, remove: true, startRuns: true, schedules: true };
const viewer = {
	save: false,
	remove: false,
	startRuns: false,
	schedules: false,
};

function setup() {
	const ports = inMemorySourcesPorts();
	ports.space.flows.saved.set(
		"web",
		flowSchema.parse({
			version: FLOW_VERSION,
			start: "sync",
			nodes: [
				{
					id: "sync",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:knowledge/web",
					inputs: { urls: "https://a.b" },
				},
			],
			edges: [],
		}),
	);
	const list = listKnowledgeSources({
		files: ports.files,
		readers: ports.readers,
		fillingFlows: listFillingFlows(ports),
	});
	return { ports, list };
}

describe("listKnowledgeSources", () => {
	test("the listing, the flows that fill it with what the role allows, and whether the reader's secret is here", async () => {
		const { ports, list } = setup();
		ports.files.listed = {
			...ports.files.listed,
			files: [{ path: "a.md", size: 1, changedAt: 1 }],
			proposed: 2,
		};
		ports.readers.isReady = false;
		const overview = await list({ projectId: "p1", can: all });
		expect(overview).toMatchObject({
			files: [{ path: "a.md", size: 1, changedAt: 1 }],
			tooLarge: false,
			proposed: 2,
			reviews: [],
			shared: false,
			olderHost: false,
			learnsFromRuns: true,
			reader: { kind: "nightshift" },
			readerReady: false,
		});
		expect(overview.syncs.map(({ flow, may }) => [flow, may])).toEqual([
			["web", { sync: true, edit: true, remove: true, removeFiles: true }],
		]);
	});

	test("a role that may do nothing sees each source with nothing to do", async () => {
		const { list } = setup();
		const overview = await list({ projectId: "p1", can: viewer });
		expect(overview.syncs[0]?.may).toEqual({
			sync: false,
			edit: false,
			remove: false,
			removeFiles: false,
		});
	});
});
