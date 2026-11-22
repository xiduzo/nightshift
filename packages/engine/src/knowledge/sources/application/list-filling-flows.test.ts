import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import { inMemorySourcesPorts } from "../adapters/out/in-memory-neighbours";
import { listFillingFlows } from "./list-filling-flows";

/** The use case listFillingFlows, on in-memory adapters. */

const DAY = 24 * 60 * 60_000;

const callFlow = (
	kit: string,
	inputs: Record<string, string>,
	device?: string,
): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		start: "sync",
		nodes: [
			{
				id: "sync",
				type: "call",
				position: { x: 0, y: 0 },
				flow: kit,
				inputs,
				...(device ? { device } : {}),
			},
		],
		edges: [],
	});

describe("listFillingFlows", () => {
	test("each flow that fills the knowledge by name, its schedule, last run and health, and the reviews apart", async () => {
		const ports = inMemorySourcesPorts();
		ports.setNow(10 * DAY);
		const { saved } = ports.space.flows;
		saved.set("web", callFlow("kit:knowledge/web", { urls: "https://a.b" }));
		saved.set("review", callFlow("kit:knowledge/review-learnings", {}));
		saved.set("broken", null);
		ports.space.schedules = [
			{ id: "web", flow: "web", inputs: {}, enabled: true, cron: "0 3 * * *" },
		];
		ports.space.runs = [
			{
				id: "r1",
				status: "finished",
				flowName: "web",
				createdAt: 1,
				endedAt: 2,
			},
		];
		const { syncs, reviews } = await listFillingFlows(ports)({
			projectId: "p1",
		});
		expect(reviews).toEqual(["review"]);
		expect(syncs).toEqual([
			{
				flow: "web",
				kits: ["kit:knowledge/web"],
				source: { kit: "kit:knowledge/web", inputs: { urls: "https://a.b" } },
				computer: null,
				schedule: { cron: "0 3 * * *", enabled: true },
				lastRun: { id: "r1", status: "finished", at: 2 },
				health: "stale",
			},
		]);
		// The flows first, then the rest at once. No computer named: no Host asked.
		expect(ports.space.calls).toEqual([
			"flows.map",
			"listSchedules",
			"listRuns 200",
		]);
	});

	test("a list that does not load in time names no other computer", async () => {
		const ports = inMemorySourcesPorts();
		ports.space.flows.saved.set(
			"folder",
			callFlow("kit:knowledge/folder", { path: "/notes" }, "device-other"),
		);
		ports.space.devicesHang();
		const { syncs } = await listFillingFlows(ports)({ projectId: "p1" });
		expect(ports.wait.waits).toEqual([2_000]);
		expect(syncs[0]?.computer).toEqual({
			name: "another computer",
			here: false,
		});
	});

	test("a project with no copy here has no schedules", async () => {
		const ports = inMemorySourcesPorts();
		ports.space.flows.saved.set(
			"web",
			callFlow("kit:knowledge/web", { urls: "https://a.b" }),
		);
		ports.space.noCopyHere();
		const { syncs } = await listFillingFlows(ports)({ projectId: "p1" });
		expect(syncs[0]?.schedule).toBeNull();
		expect(syncs[0]?.health).toBeNull();
	});
});
