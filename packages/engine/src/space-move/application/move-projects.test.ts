import { describe, expect, spyOn, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import type { RowBatch } from "../../contract";
import { spaceMovePorts } from "../test-support";
import { moveProjects } from "./move-projects";

/** The use case moveProjects, over a database in memory. */

/** Spaces `from`, `platform` and `studio`. In `from`: `app` (run r1, walked by this computer) and `tools` (run r2, walked by `b`). */
async function seeded() {
	const ports = await spaceMovePorts();
	for (const id of ["from", "platform", "studio"]) await ports.rows.space(id);
	for (const id of ["app", "tools"]) {
		await ports.rows.project({ id, spaceId: "from" });
	}
	for (const row of [
		{ id: "r1", spaceId: "from", projectId: "app", walkerId: "this-computer" },
		{ id: "r2", spaceId: "from", projectId: "tools", walkerId: "b" },
	])
		await ports.rows.run(row);
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
		const ports = await seeded();
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
		const kinds = batch.map((i) => (typeof i === "string" ? i : "rows"));
		expect(kinds.filter((kind, at) => kind !== kinds[at - 1])).toEqual([
			"rows",
			"commands platform",
			"rows",
			"commands studio",
			"own rows",
		]);
		expect((await ports.rows.runs()).map((r) => [r.id, r.spaceId])).toEqual([
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
		const ports = await seeded();
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
		const ports = await seeded();
		await ports.movedSchedules.saveSchedules("app", [
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
		const { schedules } = await ports.movedSchedules.schedules("app");
		expect(schedules).toEqual([
			schedule("nightly", false),
			schedule("weekly", false),
		]);
		// `tools` has no schedules that fire: it is skipped, not refused.
		expect(ports.steps.indexOf("save schedules app")).toBeLessThan(
			ports.steps.indexOf("commit"),
		);
	});

	test("with this computer's own runs only, the Space it leaves keeps the rest and its document, and only this computer's Clones go along", async () => {
		const ports = await seeded();
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
		expect((await ports.rows.runs()).map((r) => [r.id, r.spaceId])).toEqual([
			["r1", "platform"],
			["r2", "from"],
		]);
		expect(ports.entries.documents.get("platform")?.clones).toEqual([
			["app", "this-computer"],
		]);
		expect(ports.entries.documents.get("from")?.projects.size).toBe(2);
	});

	test("a group with no runs asks no rows above the engine", async () => {
		const ports = await seeded();
		await ports.rows.clearRuns();
		await moveProjects(ports)({
			from: "from",
			plan: async () => ({
				projects: { app: { spaceId: "platform", projectId: "app" } },
			}),
		});
		expect(ports.commands.asked).toEqual([]);
	});

	test("what follows the moved Projects may fail: the move is done, and the failure is logged", async () => {
		const ports = await seeded();
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
		const ports = await seeded();
		await moveProjects(ports)({
			from: "from",
			plan: async () => ({ projects: {} }),
		});
		expect(ports.steps).not.toContain("documents");
		expect(ports.steps).not.toContain("moved from");
	});
});
