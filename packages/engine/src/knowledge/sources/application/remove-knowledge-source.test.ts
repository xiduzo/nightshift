import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemorySourcesPorts } from "../adapters/out/in-memory-neighbours";
import { OWNER_ONLY } from "../domain/syncs";
import { removeKnowledgeSource } from "./remove-knowledge-source";

/** The use case removeKnowledgeSource, on in-memory adapters. */

const owner = { schedules: true };
const member = { schedules: false };

const callFlow = (kit: string, inputs: Record<string, string>): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		start: "sync",
		nodes: [
			{ id: "sync", type: "call", position: { x: 0, y: 0 }, flow: kit, inputs },
		],
		edges: [],
	});

function setup() {
	const ports = inMemorySourcesPorts();
	ports.space.flows.saved.set(
		"web",
		callFlow("kit:knowledge/web", { urls: "https://a.b", folder: "pages" }),
	);
	ports.space.flows.saved.set(
		"other",
		callFlow("kit:knowledge/web", { urls: "https://c.d", folder: "shared" }),
	);
	ports.space.schedules = [
		{ id: "web", flow: "web", inputs: {}, enabled: true, cron: "0 3 * * *" },
	];
	ports.files.folders.set("pages", 3);
	return ports;
}

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("removeKnowledgeSource", () => {
	test("removes the files first, then the schedules, then the flow", async () => {
		const ports = setup();
		const removed = await removeKnowledgeSource(ports)({
			projectId: "p1",
			name: "web",
			files: true,
			may: owner,
		});
		expect(removed).toEqual({ removedFiles: 3 });
		expect(ports.files.removed).toEqual(["pages"]);
		expect(ports.space.schedules).toEqual([]);
		expect(ports.space.calls).toEqual([
			"flows.map",
			"listSchedules",
			"saveSchedules",
			"flows.remove web",
		]);
	});

	test("checks first: a source with a schedule refuses someone else, and nothing changes", async () => {
		const ports = setup();
		const refusal = await refusalOf(
			removeKnowledgeSource(ports)({
				projectId: "p1",
				name: "web",
				files: true,
				may: member,
			}),
		);
		expect((refusal as Refusal).message).toBe(OWNER_ONLY);
		expect(ports.files.removed).toEqual([]);
		expect(ports.space.flows.saved.has("web")).toBe(true);
	});

	test("a failed removal of the files leaves the source in place", async () => {
		const ports = setup();
		const failure = new Error("disk");
		ports.files.failRemove(failure);
		expect(
			await refusalOf(
				removeKnowledgeSource(ports)({
					projectId: "p1",
					name: "web",
					files: true,
					may: owner,
				}),
			),
		).toBe(failure);
		expect(ports.space.schedules).toHaveLength(1);
		expect(ports.space.flows.saved.has("web")).toBe(true);
	});

	test("a flow that is no source refuses", async () => {
		const ports = setup();
		const refusal = await refusalOf(
			removeKnowledgeSource(ports)({
				projectId: "p1",
				name: "nothing",
				files: false,
				may: owner,
			}),
		);
		expect(refusal).toBeInstanceOf(Refusal);
		expect((refusal as Refusal).message).toBe(
			"This project has no such source. It may have been removed.",
		);
	});
});
