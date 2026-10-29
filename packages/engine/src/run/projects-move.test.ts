import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import {
	agentSession,
	clone,
	event,
	keptVariable,
	organization,
	project,
	run,
	runCommand,
	step,
	ydoc,
} from "@nightshift/db/schema";
import type { DecisionNode, Flow, Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { and, eq, inArray } from "drizzle-orm";
import { createRunLog, type RunLog } from "../log/run-log";
import {
	createSpaceDocuments,
	recordClone,
	type SpaceDocuments,
	spaceDocumentName,
	spaceProjects,
} from "../projects/space-document";
import { aloneDirectory } from "../testing/alone-directory";
import {
	commitFile,
	createSandbox,
	expectRunLogsInSync,
	mustGit,
	otherSpace,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine, type Engine } from "./engine";
import type { MovedRuns, MoveRows } from "./projects-move";
import { START_HOLD_WORDS } from "./start-holds";

/**
 * The Space move (`Engine.moveProjects`), as its three callers use it: a
 * person's move of a Project (between two Spaces this Replica keeps), the
 * merge of Personal into the home Host's (several target Spaces, the
 * Persons' ids there, schedules pinned, the caller's own rows), and the
 * split of a Personal of its own (this computer's runs only, schedules
 * paused, counted for the caller's row). Then forgetting the Space a move
 * emptied (`Engine.forgetSpace`), which deletes what it left.
 */

let sandbox: Sandbox;
let runLogs: RunLog[];
let signal: AbortController;
let documents: SpaceDocuments;
/** What the rows above the engine were asked to move. */
let asked: MovedRuns[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
	asked = [];
	signal = new AbortController();
	documents = createSpaceDocuments({
		db: sandbox.db,
		directory: aloneDirectory(sandbox.db),
	});
});
afterEach(async () => {
	signal.abort();
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await documents.close();
		await sandbox.cleanup();
	}
});

/** The rows of a package above the engine: the commands of the moved runs, as `devices` moves them. */
const commands: MoveRows = async (runs) => {
	asked.push(runs);
	return [
		sandbox.db
			.update(runCommand)
			.set({ spaceId: runs.to })
			.where(
				and(
					eq(runCommand.spaceId, runs.from),
					inArray(runCommand.runId, [...runs.runIds]),
				),
			),
	];
};

function makeEngine(): Engine {
	const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			spaceDocuments: documents,
			moveRows: [commands],
		}),
		{ runLog, signal: signal.signal },
	);
}

const gate: DecisionNode = {
	id: "ship",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Ship it?",
	options: [{ name: "yes" }, { name: "no" }],
	by: "person",
	decider: "typesafe",
};

/** One Gate: the run waits with a step and events. */
const flow: Flow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "ship",
	nodes: [gate],
	edges: [],
};

/** A run of the project that a person stopped at its Gate. */
async function stoppedRun(
	engine: Engine,
	projectId: string,
	spaceId: string = sandbox.spaceId,
): Promise<string> {
	const space = engine.space(spaceId);
	const { id } = await space.startRun({ projectId, flow });
	await waitFor(async () => (await space.getRun(id)).status === "waiting", {
		label: "the Gate",
	});
	await space.act(id, { kind: "stop" });
	return id;
}

/** A second repository, a Project of its own (no remote). */
async function otherRepo(): Promise<string> {
	const path = join(sandbox.root, "other");
	await mkdir(path, { recursive: true });
	await mustGit(path, ["init", "-q", "-b", "main"]);
	await commitFile(path, "README.md");
	return path;
}

describe("a Space move", () => {
	test("moves each Project to its Space in one batch with the rows above the engine and the caller's own; the run log and the documents follow", async () => {
		const engine = makeEngine();
		const mine = engine.space(sandbox.spaceId);
		const platform = await otherSpace(sandbox.db, "Platform");
		const studio = await otherSpace(sandbox.db, "Studio");
		const app = await mine.addProject({ repoPath: sandbox.repoPath });
		const tools = await mine.addProject({ repoPath: await otherRepo() });
		const runId = await stoppedRun(engine, app.id);
		await sandbox.db.insert(runCommand).values({
			id: "command-1",
			spaceId: sandbox.spaceId,
			runId,
			walkerId: sandbox.deviceId,
			kind: "run.stop",
			payload: "{}",
			personId: "someone",
		});

		const moved = await engine.moveProjects({
			from: sandbox.spaceId,
			plan: async () => ({
				projects: {
					[app.id]: { spaceId: platform, projectId: app.id },
					[tools.id]: { spaceId: studio, projectId: tools.id },
				},
			}),
			statements: (done) => [
				sandbox.db
					.update(organization)
					.set({ name: `Moved ${done.runIds.length}` })
					.where(eq(organization.id, sandbox.spaceId)),
			],
		});

		expect(moved).toEqual({
			projects: [app.id, tools.id],
			runIds: [runId],
			schedules: 0,
		});
		const spaces = await sandbox.db
			.select({ id: project.id, spaceId: project.spaceId })
			.from(project);
		expect(Object.fromEntries(spaces.map((p) => [p.id, p.spaceId]))).toEqual({
			[app.id]: platform,
			[tools.id]: studio,
		});
		// The rows above the engine: asked once per Space that runs go to.
		expect(asked).toEqual([
			{ from: sandbox.spaceId, to: platform, runIds: [runId], personMap: {} },
		]);
		const [command] = await sandbox.db.select().from(runCommand);
		expect(command?.spaceId).toBe(platform);
		const [space] = await sandbox.db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, sandbox.spaceId));
		expect(space?.name).toBe("Moved 1");
		// The run log reads the run again: its new Space has it.
		expect((await engine.space(platform).getRun(runId)).status).toBe("stopped");
		await expect(mine.getRun(runId)).rejects.toThrow(
			"Night Shift cannot find this run.",
		);
		// Every document follows the rows.
		const left = await documents.open(sandbox.spaceId);
		expect(spaceProjects(left).size).toBe(0);
		expect(left.clones.size).toBe(0);
		const onPlatform = await documents.open(platform);
		expect([...spaceProjects(onPlatform).keys()]).toEqual([app.id]);
		expect([...onPlatform.clones.keys()]).toEqual([
			`${app.id}/${sandbox.deviceId}`,
		]);
		const inStudio = await documents.open(studio);
		expect([...spaceProjects(inStudio).keys()]).toEqual([tools.id]);
	});

	test("while it plans, no run starts in its Space; one that fails before its batch moves nothing and frees the Space", async () => {
		const engine = makeEngine();
		const mine = engine.space(sandbox.spaceId);
		const platform = await otherSpace(sandbox.db, "Platform");
		const app = await mine.addProject({ repoPath: sandbox.repoPath });
		let started: unknown = null;

		await expect(
			engine.moveProjects({
				from: sandbox.spaceId,
				plan: async () => {
					started = await mine
						.startRun({ projectId: app.id, flow })
						.catch((error: unknown) => error);
					return {
						projects: { [app.id]: { spaceId: platform, projectId: app.id } },
					};
				},
				statements: () => {
					throw new Error("Stopped before the batch.");
				},
			}),
		).rejects.toThrow("Stopped before the batch.");

		expect(started).toBeInstanceOf(Refusal);
		expect((started as Refusal).message).toBe(START_HOLD_WORDS.held);
		const [row] = await sandbox.db
			.select({ spaceId: project.spaceId })
			.from(project);
		expect(row?.spaceId).toBe(sandbox.spaceId);
		expect(spaceProjects(await documents.open(platform)).size).toBe(0);
		// The Space starts runs again.
		const runId = await stoppedRun(engine, app.id);
		expect((await mine.getRun(runId)).status).toBe("stopped");
	});

	test("schedules change through the project's flows before the batch, and the caller's rows see how many", async () => {
		const engine = makeEngine();
		const mine = engine.space(sandbox.spaceId);
		const home = await otherSpace(sandbox.db, "Home");
		const app = await mine.addProject({ repoPath: sandbox.repoPath });
		const schedules: Schedule[] = [
			{ id: "nightly", cron: "0 22 * * *", inputs: {}, enabled: true },
			{
				id: "studio",
				cron: "0 6 * * *",
				inputs: {},
				enabled: true,
				device: "studio",
			},
		];
		await mine.saveSchedules(app.id, schedules);
		let counted = -1;

		await engine.moveProjects({
			from: sandbox.spaceId,
			plan: async () => ({
				projects: { [app.id]: { spaceId: home, projectId: app.id } },
				// The merge: a schedule that names no Device keeps firing its runs here.
				schedule: (schedule) =>
					schedule.device === undefined
						? { ...schedule, device: "this-computer" }
						: schedule,
			}),
			statements: (done) => {
				counted = done.schedules;
				return [];
			},
		});

		expect(counted).toBe(1);
		const listed = await engine.space(home).listSchedules(app.id);
		expect(listed.schedules.map((s) => [s.id, s.device])).toEqual([
			["nightly", "this-computer"],
			["studio", "studio"],
		]);
	});

	test("with this computer's own runs only, the Space it leaves keeps the rest and its document, and only this computer's Clones go along", async () => {
		const engine = makeEngine();
		const mine = engine.space(sandbox.spaceId);
		const copy = await otherSpace(sandbox.db, "Copy");
		const app = await mine.addProject({ repoPath: sandbox.repoPath });
		const own = await stoppedRun(engine, app.id);
		// A run another Device walked, as the exchange brought it.
		await sandbox.db.insert(run).values({
			id: "theirs",
			spaceId: sandbox.spaceId,
			projectId: app.id,
			flow: JSON.stringify(flow),
			title: "theirs",
			worktreePath: "/w/theirs",
			branch: "theirs",
			baseRef: "main",
			walkerId: "studio",
			startedBy: "someone",
		});
		const left = await documents.open(sandbox.spaceId);
		await left.change(() =>
			recordClone(left, {
				projectId: app.id,
				deviceId: "studio",
				deviceName: "studio",
			}),
		);

		const moved = await engine.moveProjects({
			from: sandbox.spaceId,
			plan: async () => ({
				projects: { [app.id]: { spaceId: copy, projectId: app.id } },
				ownRunsOnly: true,
			}),
		});

		expect(moved.runIds).toEqual([own]);
		const runs = await sandbox.db
			.select({ id: run.id, spaceId: run.spaceId })
			.from(run);
		expect(Object.fromEntries(runs.map((r) => [r.id, r.spaceId]))).toEqual({
			[own]: copy,
			theirs: sandbox.spaceId,
		});
		expect(spaceProjects(left).has(app.id)).toBe(true);
		expect(left.clones.size).toBe(2);
		const taken = await documents.open(copy);
		expect([...spaceProjects(taken).keys()]).toEqual([app.id]);
		expect([...taken.clones.keys()]).toEqual([`${app.id}/${sandbox.deviceId}`]);
	});
});

describe("forgetting a Space a move emptied", () => {
	/** What of the Space is on this Replica: the rows of each engine table that name it, and its document. */
	async function whatIsLeft(spaceId: string) {
		const count = async (
			table:
				| typeof project
				| typeof clone
				| typeof run
				| typeof step
				| typeof agentSession
				| typeof event
				| typeof keptVariable,
		) =>
			(await sandbox.db.select().from(table).where(eq(table.spaceId, spaceId)))
				.length;
		const [document] = await sandbox.db
			.select({ name: ydoc.name })
			.from(ydoc)
			.where(eq(ydoc.name, spaceDocumentName(spaceId)));
		return {
			projects: await count(project),
			clones: await count(clone),
			runs: await count(run),
			steps: await count(step),
			sessions: await count(agentSession),
			events: await count(event),
			keptValues: await count(keptVariable),
			document: document !== undefined,
		};
	}

	/**
	 * Two Spaces, each with a Project, a stopped run, a Member that joined
	 * (a fact of no run) and its document.
	 */
	async function twoSpaces(engine: Engine) {
		const team = await otherSpace(sandbox.db, "Team");
		const kept = await otherSpace(sandbox.db, "Kept");
		const app = await engine
			.space(team)
			.addProject({ repoPath: sandbox.repoPath });
		const tools = await engine
			.space(kept)
			.addProject({ repoPath: await otherRepo() });
		const teamRun = await stoppedRun(engine, app.id, team);
		const keptRun = await stoppedRun(engine, tools.id, kept);
		for (const spaceId of [team, kept]) {
			await engine.logMemberChange({
				kind: "joined",
				spaceId,
				personId: "ada",
				role: "member",
				by: null,
			});
		}
		await documents.flush();
		return { team, kept, app, tools, teamRun, keptRun };
	}

	test("is refused while a Project or a run of it is here: nothing goes", async () => {
		const engine = makeEngine();
		const { team, app } = await twoSpaces(engine);
		const before = await whatIsLeft(team);
		expect(before).toMatchObject({ projects: 1, runs: 1, document: true });

		expect(await engine.forgetSpace(team)).toBe(false);
		expect(await whatIsLeft(team)).toEqual(before);

		// A split takes this computer's runs: a run another Device walked stays.
		await sandbox.db.insert(run).values({
			id: "theirs",
			spaceId: team,
			projectId: app.id,
			flow: JSON.stringify(flow),
			title: "theirs",
			worktreePath: "/w/theirs",
			branch: "theirs",
			baseRef: "main",
			walkerId: "studio",
			startedBy: "someone",
		});
		const copy = await otherSpace(sandbox.db, "Copy");
		await engine.moveProjects({
			from: team,
			plan: async () => ({
				projects: { [app.id]: { spaceId: copy, projectId: app.id } },
				ownRunsOnly: true,
			}),
		});
		await sandbox.db.delete(organization).where(eq(organization.id, team));
		const left = await whatIsLeft(team);
		expect(left).toMatchObject({ projects: 0, runs: 1, document: true });

		expect(await engine.forgetSpace(team)).toBe(false);
		expect(await whatIsLeft(team)).toEqual(left);
	});

	test("is refused while the Space's own row is here, even once a move emptied it: nothing goes", async () => {
		const engine = makeEngine();
		const { team, app } = await twoSpaces(engine);
		const platform = await otherSpace(sandbox.db, "Platform");
		await engine.moveProjects({
			from: team,
			plan: async () => ({
				projects: { [app.id]: { spaceId: platform, projectId: app.id } },
			}),
		});
		// The caller has not removed the Space's own row yet.
		const left = await whatIsLeft(team);
		expect(left).toMatchObject({
			projects: 0,
			runs: 0,
			events: 1,
			document: true,
		});

		expect(await engine.forgetSpace(team)).toBe(false);
		expect(await whatIsLeft(team)).toEqual(left);
	});

	test("once a move emptied it, its facts of no run and its document go; the Space its runs went to and another Space keep everything", async () => {
		const engine = makeEngine();
		const { team, kept, app, tools, teamRun, keptRun } =
			await twoSpaces(engine);
		const platform = await otherSpace(sandbox.db, "Platform");
		await engine.moveProjects({
			from: team,
			plan: async () => ({
				projects: { [app.id]: { spaceId: platform, projectId: app.id } },
			}),
		});
		// Its own row goes first: the caller's (`@nightshift/auth`).
		await sandbox.db.delete(organization).where(eq(organization.id, team));
		const keptBefore = await whatIsLeft(kept);
		const platformBefore = await whatIsLeft(platform);
		expect(await whatIsLeft(team)).toMatchObject({
			projects: 0,
			runs: 0,
			events: 1,
			document: true,
		});

		expect(await engine.forgetSpace(team)).toBe(true);

		const nothing = {
			projects: 0,
			clones: 0,
			runs: 0,
			steps: 0,
			sessions: 0,
			events: 0,
			keptValues: 0,
			document: false,
		};
		expect(await whatIsLeft(team)).toEqual(nothing);
		// Where its runs went, they stay whole.
		expect(await whatIsLeft(platform)).toEqual(platformBefore);
		expect(platformBefore).toMatchObject({ projects: 1, runs: 1 });
		expect((await engine.space(platform).getRun(teamRun)).status).toBe(
			"stopped",
		);
		const onPlatform = await documents.open(platform);
		expect([...spaceProjects(onPlatform).keys()]).toEqual([app.id]);
		// Another Space keeps its Project, its run, its Member and its document.
		expect(await whatIsLeft(kept)).toEqual(keptBefore);
		expect(keptBefore).toMatchObject({ projects: 1, runs: 1, document: true });
		expect((await engine.space(kept).getRun(keptRun)).status).toBe("stopped");
		const inKept = await documents.open(kept);
		expect([...spaceProjects(inKept).keys()]).toEqual([tools.id]);

		// Again: nothing more to forget, and nothing else goes.
		expect(await engine.forgetSpace(team)).toBe(true);
		expect(await whatIsLeft(team)).toEqual(nothing);
		expect(await whatIsLeft(kept)).toEqual(keptBefore);
	});
});
