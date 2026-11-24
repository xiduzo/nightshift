import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setSystemTime,
	test,
} from "bun:test";
import {
	type AuthSandbox,
	createAuthSandbox,
	OPEN_HOST,
	testRequestAccess,
	testSpaces,
} from "@nightshift/auth/testing";
import type {
	AnswerCost,
	RunSummary,
	SpaceEngine,
	SpaceFlows,
} from "@nightshift/engine";
import type { Project } from "@nightshift/engine/projects";
import { dashboardOver } from "@nightshift/engine/testing";
import type { FlowListItem } from "@nightshift/flows";
import { asDate, now } from "@nightshift/time";
import { utc } from "@nightshift/time/testing";
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

/**
 * The clock of every test here. The router reads the clock, and the runs
 * below start one hour before it. With the real clock, such a run belongs
 * to the day before in the first hour after midnight, and the last night
 * is empty. 15:00 UTC is the same calendar day in UTC and in Amsterdam.
 */
const NOW = utc(2026, 9, 21, 15);

let sandbox: AuthSandbox;
beforeEach(async () => {
	setSystemTime(asDate(NOW));
	sandbox = await createAuthSandbox();
});
afterEach(() => {
	sandbox.cleanup();
	setSystemTime();
});

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
		neededYou: [],
		metrics: {
			wallMs: null,
			agentMs: 0,
			gateWaitMs: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			costBasis: "billed",
			prUrl: null,
		},
		lastActivityAt: 0,
		endReason: "finished",
		...fields,
	};
}

/** What each Space holds: its projects and their runs and flows. */
type SpaceData = {
	projects: { id: string; name: string }[];
	runs: RunSummary[];
	flows: string[];
	/** What the answers of Night Shift's own agents cost. */
	help?: AnswerCost[];
};

/**
 * An engine whose Spaces hold `data`, with its dashboard over them, and
 * the Spaces it was asked for. The dashboard opens a Space once per read,
 * so a test compares the Spaces, each once (`once`).
 */
function engineOf(data: Record<string, SpaceData>) {
	const asked: string[] = [];
	const space: Context["engine"]["space"] = (spaceId: string) => {
		asked.push(spaceId);
		const held = data[spaceId] ?? { projects: [], runs: [], flows: [] };
		return stub<SpaceEngine>("space", {
			listProjects: async () =>
				held.projects.map((project) => stub<Project>("project", project)),
			listRuns: async (input) =>
				held.runs.filter(
					(run) =>
						input?.projectId === undefined || run.projectId === input.projectId,
				),
			listAnswerCosts: async () => held.help ?? [],
			flows: stub<SpaceFlows>("flows", {
				list: async () =>
					held.flows.map((name) => stub<FlowListItem>("flow", { name })),
			}),
		});
	};
	const engine: Partial<Context["engine"]> = {
		space,
		dashboard: dashboardOver(space),
	};
	return { engine, asked };
}

/** Each Space once, in the order of its first ask. */
const once = (spaces: readonly string[]) => [...new Set(spaces)];

async function contextFor(
	headers: Headers,
	engine: Partial<Context["engine"]>,
): Promise<Context> {
	return testContext({
		access: await testRequestAccess(
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
	const personal =
		(await testSpaces(sandbox.db).personal.findPersonalSpace({
			personId: person.userId,
		})) ?? "";
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
					aRun({ id: "a", projectId: "web" }),
					aRun({ id: "b", projectId: "gone", createdAt: now() - 2 * HOUR }),
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
		expect(once(asked)).toEqual([platform]);
		expect(summary.lastNight?.latest.map((run) => [run.id, run.group])).toEqual(
			[
				["a", "website"],
				["b", "Removed"],
			],
		);
		expect(summary.watch.watched).toBe(2);
		expect(summary.nights.map((range) => range.flows)).toEqual([
			null,
			null,
			null,
		]);
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
				runs: [
					aRun({ id: "c", projectId: "mine", createdAt: now() - 2 * HOUR }),
				],
				flows: [],
			},
		});
		const summary = await call(
			appRouter.dashboard.summary,
			{ everySpace: true },
			{ context: await contextFor(headers, engine) },
		);
		expect(once(asked.slice(1)).sort()).toEqual([personal, platform].sort());
		expect(summary.lastNight?.latest.map((run) => [run.id, run.group])).toEqual(
			[
				["a", "website"],
				["c", "notes"],
			],
		);
		expect(summary.watch.watched).toBe(2);
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
		expect(summary.lastNight?.latest.map((run) => [run.id, run.group])).toEqual(
			[
				["a", "night"],
				["b", "Quick runs"],
			],
		);
		expect(summary.flowHealth?.rows.map((row) => [row.name, row.runs])).toEqual(
			[
				["night", 1],
				["deploy", 0],
			],
		);
	});

	test("counts a day on the clock of the time zone it is asked for", async () => {
		const { headers, platform } = await ada();
		// 22:30 UTC the evening before: today in Amsterdam, yesterday in UTC.
		const eve = now() - 16.5 * HOUR;
		const { engine } = engineOf({
			[platform]: {
				projects: [{ id: "web", name: "website" }],
				runs: [
					aRun({ id: "a", projectId: "web" }),
					aRun({ id: "eve", projectId: "web", createdAt: eve, endedAt: eve }),
				],
				flows: ["night"],
			},
		});
		const latestIn = async (timeZone?: string) => {
			const summary = await call(
				appRouter.dashboard.summary,
				{ projectId: "web", timeZone },
				{ context: await contextFor(headers, engine) },
			);
			return summary.lastNight?.latest.map((run) => run.id);
		};
		expect(await latestIn("Europe/Amsterdam")).toEqual(["a", "eve"]);
		expect(await latestIn("UTC")).toEqual(["a"]);
		expect(await latestIn()).toEqual(["a"]);
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

describe("dashboard.spend", () => {
	test("gives what the runs of the session's Space cost, per flow, with the ways to save", async () => {
		const { headers, personal, platform } = await ada();
		const { engine, asked } = engineOf({
			[platform]: {
				projects: [{ id: "web", name: "website" }],
				runs: [
					aRun({ id: "a", projectId: "web", costUsd: 2 }),
					aRun({ id: "b", projectId: "web", costUsd: 3, status: "failed" }),
				],
				flows: [],
			},
			[personal]: {
				projects: [],
				runs: [aRun({ id: "c", costUsd: 100 })],
				flows: [],
			},
		});
		const spend = await call(
			appRouter.dashboard.spend,
			{ timeZone: "Europe/Amsterdam" },
			{ context: await contextFor(headers, engine) },
		);
		expect(once(asked)).toEqual([platform]);
		const week = spend.ranges.find((range) => range.nights === 7);
		expect(week?.total).toBe(5);
		expect(week?.flows).toMatchObject([
			{ key: "web/night", projectId: "web", flow: "night", spent: 5, saves: 3 },
		]);
		expect(week?.savings).toMatchObject([
			{
				kind: "unfinished",
				flow: "night",
				saves: 3,
				runs: 1,
				of: 2,
				runId: "b",
			},
		]);
		expect(week?.help).toEqual({
			total: 0,
			answers: 0,
			unknown: 0,
			agents: [],
		});
	});

	test("gives what Night Shift's own agents cost in the Space, apart from the runs", async () => {
		const { headers, personal, platform } = await ada();
		const answer = (fields: Partial<AnswerCost>): AnswerCost => ({
			at: now() - 60_000,
			agent: "builder",
			entry: "flow.build",
			projectId: "web",
			spaceId: platform,
			personId: "ada",
			inputTokens: 100,
			outputTokens: 10,
			costUsd: 1,
			...fields,
		});
		const { engine } = engineOf({
			[platform]: {
				projects: [{ id: "web", name: "website" }],
				runs: [aRun({ id: "a", projectId: "web", costUsd: 2 })],
				flows: [],
				help: [
					answer({ costUsd: 0.5 }),
					answer({ agent: "explainer", entry: "run.why", costUsd: 1.5 }),
				],
			},
			[personal]: {
				projects: [],
				runs: [],
				flows: [],
				help: [answer({ spaceId: personal, costUsd: 100 })],
			},
		});
		const spend = await call(
			appRouter.dashboard.spend,
			{ timeZone: "UTC" },
			{ context: await contextFor(headers, engine) },
		);
		const week = spend.ranges.find((range) => range.nights === 7);
		expect(week?.total).toBe(2);
		expect(week?.help).toEqual({
			total: 2,
			answers: 2,
			unknown: 0,
			agents: [
				{ agent: "explainer", answers: 1, costUsd: 1.5 },
				{ agent: "builder", answers: 1, costUsd: 0.5 },
			],
		});
	});
});
