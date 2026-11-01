import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { personalSpaceId, requestAccess } from "@nightshift/auth";
import {
	type AuthSandbox,
	createAuthSandbox,
	OPEN_HOST,
} from "@nightshift/auth/testing";
import type { RunSummary, SpaceEngine, SpaceFlows } from "@nightshift/engine";
import type { Project } from "@nightshift/engine/projects";
import type { FlowListItem } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { call, ORPCError } from "@orpc/server";
import type { Context } from "../context";
import { appRouter } from "../router";
import { stub, testContext } from "../testing/context";

/**
 * The dashboard procedures: they read the runs of the session's Space (or
 * of every Space the Person is in) and reply with the numbers the engine
 * computes from them.
 */

const HOUR = 60 * 60 * 1000;

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

function aRun(fields: Partial<RunSummary>): RunSummary {
	const walker = { id: "device-1", name: null, thisDevice: true };
	return {
		id: "run",
		projectId: "p1",
		walker,
		device: walker,
		trigger: { kind: "manual" },
		startedBy: null,
		flowName: "night",
		title: "Night",
		worktreePath: "",
		branch: "nightshift/run",
		baseRef: "main",
		status: "finished",
		reason: null,
		result: null,
		wakeAt: null,
		signal: null,
		inputs: {},
		stopAt: null,
		stopAfterStep: false,
		createdAt: now() - HOUR,
		endedAt: now() - HOUR / 2,
		costUsd: 1,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		subflows: [],
		gates: [],
		sleeps: [],
		...fields,
	};
}

/** What each Space holds: its projects and their runs and flows. */
type SpaceData = {
	projects: { id: string; name: string }[];
	runs: RunSummary[];
	flows: string[];
};

/** An engine whose Spaces hold `data`, and the Spaces it was asked for. */
function engineOf(data: Record<string, SpaceData>) {
	const asked: string[] = [];
	const engine: Partial<Context["engine"]> = {
		space: (spaceId: string) => {
			asked.push(spaceId);
			const space = data[spaceId] ?? { projects: [], runs: [], flows: [] };
			return stub<SpaceEngine>("space", {
				listProjects: async () =>
					space.projects.map((project) => stub<Project>("project", project)),
				listRuns: async (input) =>
					space.runs.filter(
						(run) =>
							input?.projectId === undefined ||
							run.projectId === input.projectId,
					),
				flows: stub<SpaceFlows>("flows", {
					list: async () =>
						space.flows.map((name) => stub<FlowListItem>("flow", { name })),
				}),
			});
		},
	};
	return { engine, asked };
}

async function contextFor(
	headers: Headers,
	engine: Partial<Context["engine"]>,
): Promise<Context> {
	return testContext({
		access: await requestAccess(
			sandbox.auth,
			sandbox.db,
			headers,
			null,
			OPEN_HOST,
		),
		db: sandbox.db,
		engine,
	});
}

/** Ada with her personal Space and the Space Platform, which she works in. */
async function ada() {
	const person = await sandbox.signUp("Ada");
	const personal = (await personalSpaceId(sandbox.db, person.userId)) ?? "";
	const platform = await sandbox.auth.api.createOrganization({
		headers: person.headers,
		body: { name: "Platform", slug: "platform" },
	});
	if (!platform) throw new Error("no space");
	await sandbox.auth.api.setActiveOrganization({
		headers: person.headers,
		body: { organizationId: platform.id },
	});
	return { headers: person.headers, personal, platform: platform.id };
}

describe("dashboard.summary", () => {
	test("covers the session's Space, its runs grouped by project", async () => {
		const { headers, personal, platform } = await ada();
		const { engine, asked } = engineOf({
			[platform]: {
				projects: [{ id: "web", name: "website" }],
				runs: [
					aRun({ id: "a", projectId: "web", costUsd: 2 }),
					aRun({ id: "b", projectId: "gone", status: "failed" }),
				],
				flows: [],
			},
			[personal]: {
				projects: [{ id: "mine", name: "notes" }],
				runs: [aRun({ id: "c", projectId: "mine" })],
				flows: [],
			},
		});
		const summary = await call(
			appRouter.dashboard.summary,
			{ timeZone: "Europe/Amsterdam" },
			{ context: await contextFor(headers, engine) },
		);
		expect(asked).toEqual([platform]);
		expect(summary.cards.lastDay).toMatchObject({
			runs: 2,
			finished: 1,
			failed: 1,
		});
		const week = summary.nights.find((range) => range.nights === 7);
		expect(week?.spend.groups.map((group) => group.label)).toEqual([
			"website",
			"Removed",
		]);
		expect(summary.recent.map((run) => run.id).sort()).toEqual(["a", "b"]);
		expect(summary.flowHealth).toBeNull();
	});

	test("covers every Space the Person is in, when asked", async () => {
		const { headers, personal, platform } = await ada();
		const { engine, asked } = engineOf({
			[platform]: {
				projects: [{ id: "web", name: "website" }],
				runs: [aRun({ id: "a", projectId: "web" })],
				flows: [],
			},
			[personal]: {
				projects: [{ id: "mine", name: "notes" }],
				runs: [aRun({ id: "c", projectId: "mine", costUsd: 3 })],
				flows: [],
			},
		});
		const summary = await call(
			appRouter.dashboard.summary,
			{ everySpace: true },
			{ context: await contextFor(headers, engine) },
		);
		expect(asked.slice(1).sort()).toEqual([personal, platform].sort());
		expect(summary.cards.lastDay.runs).toBe(2);
		expect(summary.cards.allTime.costUsd).toBe(4);
		const week = summary.nights.find((range) => range.nights === 7);
		expect(week?.spend.groups.map((group) => group.label)).toEqual([
			"notes",
			"website",
		]);
	});

	test("covers one project, its runs grouped by flow, with Flow health", async () => {
		const { headers, platform } = await ada();
		const { engine } = engineOf({
			[platform]: {
				projects: [{ id: "web", name: "website" }],
				runs: [
					aRun({ id: "a", projectId: "web", flowName: "night" }),
					aRun({ id: "b", projectId: "web", flowName: null }),
					aRun({ id: "c", projectId: "other" }),
				],
				flows: ["night", "deploy"],
			},
		});
		const summary = await call(
			appRouter.dashboard.summary,
			{ projectId: "web", timeZone: "UTC" },
			{ context: await contextFor(headers, engine) },
		);
		expect(summary.cards.lastDay.runs).toBe(2);
		const week = summary.nights.find((range) => range.nights === 7);
		expect(week?.runs.groups.rows.map((group) => group.label).sort()).toEqual(
			["Quick runs", "night"].sort(),
		);
		expect(summary.flowHealth?.rows.map((row) => row.name)).toEqual([
			"night",
			"deploy",
		]);
	});

	test("refuses a time zone it does not know", async () => {
		const { headers } = await ada();
		const { engine } = engineOf({});
		const error = await call(
			appRouter.dashboard.summary,
			{ timeZone: "Nowhere/Atlantis" },
			{ context: await contextFor(headers, engine) },
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ORPCError);
		expect((error as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
	});
});

describe("dashboard.flow", () => {
	test("gives one flow's health per night range, its subflow runs included", async () => {
		const { headers, platform } = await ada();
		const { engine } = engineOf({
			[platform]: {
				projects: [],
				runs: [
					aRun({ id: "a", projectId: "web", flowName: "night" }),
					aRun({
						id: "b",
						projectId: "web",
						flowName: "deploy",
						subflows: [
							{
								flowName: "night",
								status: "failed",
								costUsd: 1,
								costEstimated: false,
								costMissing: 0,
								costCalls: 1,
								startedAt: now() - HOUR,
								endedAt: now(),
							},
						],
					}),
				],
				flows: [],
			},
		});
		const detail = await call(
			appRouter.dashboard.flow,
			{ projectId: "web", flowName: "night" },
			{ context: await contextFor(headers, engine) },
		);
		expect(detail.ranges.map((range) => range.nights)).toEqual([7, 30, 90]);
		expect(detail.ranges[0]).toMatchObject({
			runs: 2,
			asSubflow: 1,
			finished: 1,
			unfinished: 1,
		});
	});
});
