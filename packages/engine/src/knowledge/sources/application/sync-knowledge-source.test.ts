import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, flowSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemorySourcesPorts } from "../adapters/out/in-memory-neighbours";
import { syncKnowledgeSource } from "./sync-knowledge-source";

/** The use case syncKnowledgeSource, on in-memory adapters. */

describe("syncKnowledgeSource", () => {
	test("starts a run of the source's flow, by whom the person is", async () => {
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
		const run = await syncKnowledgeSource(ports)({
			projectId: "p1",
			name: "web",
			startedBy: "person-1",
		});
		expect(run).toMatchObject({ flowName: "web", status: "running" });
		expect(ports.space.calls).toEqual(["flows.map", "startRun web"]);
	});

	test("a flow that is no source starts nothing", async () => {
		const ports = inMemorySourcesPorts();
		const refusal = await syncKnowledgeSource(ports)({
			projectId: "p1",
			name: "nothing",
			startedBy: "person-1",
		}).catch((error: unknown) => error);
		expect(refusal).toBeInstanceOf(Refusal);
		expect(ports.space.calls).toEqual(["flows.map"]);
	});
});
