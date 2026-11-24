import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
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

async function setup() {
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
	for (const path of [
		"pages/a.md",
		"pages/b.md",
		"pages/c/d.md",
		"shared/e.md",
	]) {
		await ports.sync.publish("p1", path, path);
	}
	return ports;
}

/** The files the Space lists. */
const listedIn = async (ports: Awaited<ReturnType<typeof setup>>) => [
	...(await ports.sync.documents.open("p1")).entries().keys(),
];

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("removeKnowledgeSource", () => {
	test("removes the files first, then the schedules, then the flow", async () => {
		const ports = await setup();
		const removed = await removeKnowledgeSource(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			name: "web",
			files: true,
			may: owner,
		});
		expect(removed).toEqual({ removedFiles: 3 });
		expect(await listedIn(ports)).toEqual(["shared/e.md"]);
		expect(ports.space.schedules).toEqual([]);
		expect(ports.space.calls).toEqual([
			"flows.map",
			"listSchedules",
			"saveSchedules",
			"flows.remove web",
		]);
	});

	test("keeps a folder another flow fills too", async () => {
		const ports = await setup();
		ports.space.flows.saved.set(
			"drawn",
			callFlow("kit:knowledge/web", { urls: "https://e.f", folder: "pages" }),
		);
		const removed = await removeKnowledgeSource(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			name: "web",
			files: true,
			may: owner,
		});
		expect(removed).toEqual({ removedFiles: 0 });
		expect(await listedIn(ports)).toHaveLength(4);
	});

	test("checks first: a source with a schedule refuses someone else, and nothing changes", async () => {
		const ports = await setup();
		const refusal = await refusalOf(
			removeKnowledgeSource(ports)(NIGHT_SHIFT, {
				spaceId: "space-1",
				projectId: "p1",
				name: "web",
				files: true,
				may: member,
			}),
		);
		expect((refusal as Refusal).message).toBe(OWNER_ONLY);
		expect(await listedIn(ports)).toHaveLength(4);
		expect(ports.space.flows.saved.has("web")).toBe(true);
	});

	test("a failed removal of the files leaves the source in place", async () => {
		const ports = await setup();
		// A run writes the folder now.
		await ports.reconciler.startStep("p1");
		expect(
			await refusalOf(
				removeKnowledgeSource(ports)(NIGHT_SHIFT, {
					spaceId: "space-1",
					projectId: "p1",
					name: "web",
					files: true,
					may: owner,
				}),
			),
		).toBeInstanceOf(Refusal);
		expect(ports.space.schedules).toHaveLength(1);
		expect(ports.space.flows.saved.has("web")).toBe(true);
	});

	test("a flow that is no source refuses", async () => {
		const ports = await setup();
		const refusal = await refusalOf(
			removeKnowledgeSource(ports)(NIGHT_SHIFT, {
				spaceId: "space-1",
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

	test("owners, admins and members may, and nobody else", async () => {
		// With the files it asks for a second right.
		for (const files of [false, true]) {
			const ports = await setup();
			expect(
				await ports.access.whoMay(
					"space-1",
					(actor) =>
						removeKnowledgeSource(ports)(actor, {
							spaceId: "space-1",
							projectId: "p1",
							name: "web",
							files,
							may: owner,
						}),
					() => ports.space.calls,
				),
			).toEqual(allowing("owner", "admin", "member"));
		}
	});
});
