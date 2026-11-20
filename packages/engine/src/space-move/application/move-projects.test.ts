import { describe, expect, spyOn, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { asDate } from "@nightshift/time";
import type { RowBatch } from "../../contract";
import { inMemorySpaceMovePorts } from "../adapters/out/in-memory-neighbours";
import { moveProjects } from "./move-projects";

/** The use case moveProjects, on in-memory adapters. */

/** Spaces `from`, `platform` and `studio`. In `from`: `app` (run r1, walked by this computer) and `tools` (run r2, walked by `b`). */
function seeded() {
	const ports = inMemorySpaceMovePorts();
	for (const id of ["from", "platform", "studio"]) ports.rows.spaces.add(id);
	for (const id of ["app", "tools"]) {
		ports.rows.projects.set(id, {
			id,
			spaceId: "from",
			name: id,
			remote: null,
			folder: true,
			createdAt: asDate(0),
			removedAt: null,
		});
	}
	ports.rows.runs.push(
		{ id: "r1", spaceId: "from", projectId: "app", walkerId: "this-computer" },
		{ id: "r2", spaceId: "from", projectId: "tools", walkerId: "b" },
	);
	ports.entries.documents.set("from", {
		projects: new Map([
			["app", { name: "App", remote: null }],
			["tools", { name: "Tools", remote: null }],
		]),
		clones: [
			["app", "this-computer"],
			["tools", "b"],
		],
	});
	return ports;
}

const schedule = (name: string, enabled: boolean) =>
	({ name, enabled }) as unknown as Schedule;

describe("moveProjects", () => {
	test("moves each Project to its Space in one batch with the rows above the engine and the caller's own; the run log and the documents follow", async () => {
		const ports = seeded();
		const moved = await moveProjects(ports)({
			from: "from",
			plan: async () => {
				ports.steps.push("plan");
				return {
					projects: {
						app: { spaceId: "platform", projectId: "app" },
						tools: { spaceId: "studio", projectId: "tools" },
					},
				};
			},
			statements: (done) => {
				ports.steps.push(`statements ${done.runIds.join(",")}`);
				return ["own rows"] as unknown as RowBatch;
			},
		});

		expect(moved).toEqual({
			projects: ["app", "tools"],
			runIds: ["r1", "r2"],
			schedules: 0,
		});
		expect(ports.steps).toEqual([
			"hold schedules",
			"hold starts from",
			"plan",
			"walker",
			"run ids from app",
			"run ids from tools",
			"project rows",
			"batch platform",
			"rows commands platform",
			"batch studio",
			"rows commands studio",
			"statements r1,r2",
			"commit",
			"reread r1,r2",
			"documents",
			"moved from",
			"release starts from",
			"release schedules",
		]);
		expect(ports.commands.asked).toEqual([
			{ from: "from", to: "platform", runIds: ["r1"], personMap: {} },
			{ from: "from", to: "studio", runIds: ["r2"], personMap: {} },
		]);
		// One batch: the rows of each Space, then the rows above, then the caller's.
		expect(ports.rows.committed).toHaveLength(1);
		const batch = ports.rows.committed[0] ?? [];
		expect(batch.filter((item) => typeof item === "string")).toEqual([
			"commands platform",
			"commands studio",
			"own rows",
		]);
		expect(batch.indexOf("commands platform")).toBe(3);
		expect(batch.at(-1)).toBe("own rows");
		expect(ports.rows.runs.map((r) => [r.id, r.spaceId])).toEqual([
			["r1", "platform"],
			["r2", "studio"],
		]);
		expect(ports.entries.documents.get("platform")?.clones).toEqual([
			["app", "this-computer"],
		]);
		expect(ports.entries.documents.get("from")?.projects.size).toBe(0);
		expect(ports.projectsMoved.followed).toEqual([
			{
				from: "from",
				projects: {
					app: { spaceId: "platform", projectId: "app" },
					tools: { spaceId: "studio", projectId: "tools" },
				},
			},
		]);
	});

	test("while it plans, the holds are on; one that fails before its batch moves nothing and frees the Space", async () => {
		const ports = seeded();
		await expect(
			moveProjects(ports)({
				from: "from",
				plan: async () => {
					throw new Error("A run is not done.");
				},
			}),
		).rejects.toThrow("A run is not done.");
		expect(ports.steps).toEqual([
			"hold schedules",
			"hold starts from",
			"release starts from",
			"release schedules",
		]);
		expect(ports.rows.committed).toEqual([]);
	});

	test("schedules change before the batch, and the caller's rows see how many", async () => {
		const ports = seeded();
		ports.movedSchedules.lists.set("app", [
			schedule("nightly", true),
			schedule("weekly", false),
		]);
		let counted = -1;
		const moved = await moveProjects(ports)({
			from: "from",
			plan: async () => ({
				projects: {
					app: { spaceId: "platform", projectId: "app" },
					tools: { spaceId: "platform", projectId: "tools" },
				},
				schedule: (s) => (s.enabled ? { ...s, enabled: false } : s),
			}),
			statements: (done) => {
				counted = done.schedules;
				return [];
			},
		});
		expect(moved.schedules).toBe(1);
		expect(counted).toBe(1);
		expect(ports.movedSchedules.lists.get("app")).toEqual([
			schedule("nightly", false),
			schedule("weekly", false),
		]);
		// `tools` has no schedules that fire: it is skipped, not refused.
		expect(ports.steps.indexOf("save schedules app")).toBeLessThan(
			ports.steps.indexOf("commit"),
		);
	});

	test("with this computer's own runs only, the Space it leaves keeps the rest and its document, and only this computer's Clones go along", async () => {
		const ports = seeded();
		await moveProjects(ports)({
			from: "from",
			plan: async () => ({
				projects: {
					app: { spaceId: "platform", projectId: "app" },
					tools: { spaceId: "platform", projectId: "tools" },
				},
				ownRunsOnly: true,
			}),
		});
		expect(ports.rows.runs.map((r) => [r.id, r.spaceId])).toEqual([
			["r1", "platform"],
			["r2", "from"],
		]);
		expect(ports.entries.documents.get("platform")?.clones).toEqual([
			["app", "this-computer"],
		]);
		expect(ports.entries.documents.get("from")?.projects.size).toBe(2);
	});

	test("a group with no runs asks no rows above the engine", async () => {
		const ports = seeded();
		ports.rows.runs.length = 0;
		await moveProjects(ports)({
			from: "from",
			plan: async () => ({
				projects: { app: { spaceId: "platform", projectId: "app" } },
			}),
		});
		expect(ports.commands.asked).toEqual([]);
	});

	test("what follows the moved Projects may fail: the move is done, and the failure is logged", async () => {
		const ports = seeded();
		ports.projectsMoved.failNext();
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const moved = await moveProjects(ports)({
				from: "from",
				plan: async () => ({
					projects: { app: { spaceId: "platform", projectId: "app" } },
				}),
			});
			expect(moved.projects).toEqual(["app"]);
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	test("no Projects: the documents and what follows them are not asked", async () => {
		const ports = seeded();
		await moveProjects(ports)({
			from: "from",
			plan: async () => ({ projects: {} }),
		});
		expect(ports.steps).not.toContain("documents");
		expect(ports.steps).not.toContain("moved from");
	});
});
