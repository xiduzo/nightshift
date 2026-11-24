import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, flowSchema, singleAgentFlow } from "@nightshift/flows";
import {
	flowHistory,
	restorableFlow,
	revisionNotFound,
	revisionView,
} from "./revisions";

const flow = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);
const revision = {
	id: "r-1",
	at: 1,
	kind: "save",
	personId: "ada",
	deviceId: "laptop",
	flow,
};
const none = async () => new Map<string, string>();

describe("the history of a flow", () => {
	test("each revision names who saved it, and the current one is marked", async () => {
		const history = await flowHistory("build", {
			sources: async () => ({ build: { json: flow, revision: "r-1" } }),
			revisions: async () => [revision],
			persons: async () => new Map([["ada", "Ada"]]),
			devices: none,
			notFound: () => new Error("gone"),
		});
		expect(history.items).toEqual([
			{
				id: "r-1",
				at: 1,
				kind: "save",
				person: { id: "ada", name: "Ada" },
				device: { id: "laptop", name: null },
				current: true,
				changes: null,
			},
		]);
		expect(revisionView(history, "r-1", undefined).diff).not.toBeNull();
	});

	test("a revision of an older format is listed, without a flow or a diff", async () => {
		const older = {
			...revision,
			id: "r-0",
			kind: "upgrade",
			flow: { ...flow, version: FLOW_VERSION - 1 },
		};
		const history = await flowHistory("build", {
			sources: async () => ({ build: { json: flow, revision: "r-1" } }),
			revisions: async () => [older, revision],
			persons: none,
			devices: none,
			notFound: () => new Error("gone"),
		});
		expect(
			history.items.map(({ id, kind, changes }) => [id, kind, changes]),
		).toEqual([
			["r-0", "upgrade", null],
			["r-1", "save", null],
		]);
		const view = revisionView(history, "r-0", undefined);
		expect([view.revision.flow, view.diff]).toEqual([null, null]);
		expect(view.against.flow).toEqual(flow);
		expect(revisionView(history, "r-1", "r-0").diff).toBeNull();
	});

	test("a flow that does not exist gives the refusal it is handed", async () => {
		const history = flowHistory("gone", {
			sources: async () => ({}),
			revisions: async () => [],
			persons: none,
			devices: none,
			notFound: () => new Error("gone"),
		});
		await expect(history).rejects.toThrow("gone");
	});

	test("the words of a revision that is not there, or not a flow", () => {
		expect(revisionNotFound().kind).toBe("not-found");
		expect(revisionNotFound().message).toBe(
			"This revision does not exist. Open the flow's revisions again.",
		);
		expect(restorableFlow(revision)).toEqual(flow);
		expect(() => restorableFlow({ flow: { nodes: "no" } })).toThrow(
			"This revision is not a valid flow, so you cannot restore it.",
		);
		expect(() =>
			restorableFlow({ flow: { ...flow, version: FLOW_VERSION - 1 } }),
		).toThrow(
			"An older version of Night Shift made this flow. You cannot restore it.",
		);
	});
});
