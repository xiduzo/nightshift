import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	agentSession,
	clone,
	device,
	event,
	keptVariable,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { createRunBus } from "../log/bus";
import { createRunHistory } from "../log/history";
import { createLandedFeed } from "../log/landed";
import { createRunLog, type RunLog } from "../log/run-log";
import {
	createSandbox,
	otherSpace,
	type Sandbox,
} from "../testing/test-support";
import { type SpaceMove, spaceMoveBatch } from "./space-rows";

/**
 * Two Spaces of one Replica: `from`, the Device's own personal Space, and
 * `to`, the personal Space its Home Host keeps. In `from`: `mine` (moves
 * as itself), `dup` (its remote is `hosted`'s, so it maps onto `hosted`)
 * and `stay` (not moved). In `to`: `hosted`.
 */
let sandbox: Sandbox;
let from: string;
let to: string;
let log: RunLog;
let walker: string;
const LOCAL = "ada-local";
const HOSTED = "ada-hosted";
const STUDIO = "studio";

beforeEach(async () => {
	sandbox = await createSandbox();
	from = sandbox.spaceId;
	to = await otherSpace(sandbox.db, "Home");
	walker = sandbox.deviceId;
	log = createRunLog(sandbox.db, { walkerId: walker });
	await sandbox.db
		.insert(device)
		.values({ id: STUDIO, name: "studio", platform: "linux" });
});
afterEach(async () => {
	await sandbox.cleanup();
});

async function addProject(id: string, spaceId: string, remote: string | null) {
	await sandbox.db.insert(project).values({ id, spaceId, name: id, remote });
}

async function addRun(id: string, projectId: string, spaceId: string) {
	await sandbox.db.insert(run).values({
		id,
		spaceId,
		projectId,
		flow: "{}",
		title: id,
		worktreePath: `/w/${id}`,
		branch: id,
		baseRef: "main",
		walkerId: walker,
		startedBy: LOCAL,
	});
	await sandbox.db.insert(step).values({
		id: `${id}-step`,
		spaceId,
		runId: id,
		nodeId: "n1",
		nodeType: "agent",
		visit: 1,
		transcriptPath: `/t/${id}`,
	});
	await sandbox.db.insert(agentSession).values({
		id: `${id}-session`,
		spaceId,
		runId: id,
		stepId: `${id}-step`,
		prompt: "Go",
	});
}

/** A run's start and the move of its Walker, as this computer logs them. */
async function logRun(runId: string, projectId: string) {
	await log.append({
		type: "RunStarted",
		runId,
		payload: {
			projectId,
			flowName: "triage",
			title: runId,
			start: "n1",
			startedBy: LOCAL,
		},
	});
	await log.append({
		type: "WalkerMoved",
		runId,
		payload: { from: walker, to: walker, by: LOCAL },
	});
}

async function keep(
	projectId: string,
	spaceId: string,
	name: string,
	value: string,
	updatedAt: number,
) {
	await sandbox.db.insert(keptVariable).values({
		spaceId,
		projectId,
		flowName: "triage",
		name,
		value: JSON.stringify(value),
		runId: "r",
		stepId: "s",
		updatedAt: new Date(updatedAt),
	});
}

async function seed(options: { hostedRow: boolean }) {
	await addProject("mine", from, "github.com/acme/mine");
	await addProject("dup", from, "github.com/acme/app");
	await addProject("stay", from, "github.com/acme/stay");
	if (options.hostedRow) await addProject("hosted", to, null);

	await sandbox.db.insert(clone).values([
		{
			id: "c-mine",
			spaceId: from,
			projectId: "mine",
			deviceId: walker,
			path: "/mine",
		},
		{
			id: "c-dup",
			spaceId: from,
			projectId: "dup",
			deviceId: walker,
			path: "/app",
		},
		{
			id: "c-dup-studio",
			spaceId: from,
			projectId: "dup",
			deviceId: STUDIO,
			path: "/s/app",
		},
		{
			id: "c-stay",
			spaceId: from,
			projectId: "stay",
			deviceId: walker,
			path: "/stay",
		},
	]);
	if (options.hostedRow) {
		await sandbox.db.insert(clone).values({
			id: "c-hosted-studio",
			spaceId: to,
			projectId: "hosted",
			deviceId: STUDIO,
			path: "/s/hosted",
		});
	}

	await addRun("r-mine", "mine", from);
	await addRun("r-dup", "dup", from);
	await addRun("r-stay", "stay", from);
	if (options.hostedRow) await addRun("r-hosted", "hosted", to);

	// Interleaved, as a computer that works in both Spaces logs them.
	await logRun("r-mine", "mine");
	if (options.hostedRow) await logRun("r-hosted", "hosted");
	await log.append({
		type: "ProjectAdded",
		payload: {
			projectId: "dup",
			name: "dup",
			repoPath: "/app",
			remote: "github.com/acme/app",
		},
	});
	await logRun("r-dup", "dup");
	await log.append({
		type: "ScheduleFired",
		payload: {
			projectId: "dup",
			scheduleId: "nightly",
			at: 1,
			runId: "r-dup",
			error: null,
		},
	});
	await logRun("r-stay", "stay");
	await log.append({
		type: "MemberJoined",
		spaceId: from,
		payload: { personId: LOCAL, role: "owner", by: null },
	});

	await keep("mine", from, "count", "mine", 1);
	await keep("dup", from, "newer-here", "dup", 20);
	await keep("dup", from, "newer-there", "dup", 10);
	await keep("dup", from, "only-here", "dup", 10);
	if (options.hostedRow) {
		await keep("hosted", to, "newer-here", "hosted", 10);
		await keep("hosted", to, "newer-there", "hosted", 20);
	}
}

const move = (extra: Partial<SpaceMove> = {}): SpaceMove => ({
	from,
	to,
	projectMap: { mine: "mine", dup: "hosted" },
	personMap: { [LOCAL]: HOSTED },
	walkerId: walker,
	...extra,
});

async function runMove(input: SpaceMove = move()) {
	await sandbox.db.batch(await spaceMoveBatch(sandbox.db, input));
}

const spacesOf = async (
	table:
		| typeof clone
		| typeof run
		| typeof step
		| typeof agentSession
		| typeof keptVariable,
	projectIds: string[],
) => {
	const runIds = (
		await sandbox.db
			.select({ id: run.id })
			.from(run)
			.where(inArray(run.projectId, projectIds))
	).map((r) => r.id);
	const rows =
		table === step || table === agentSession
			? await sandbox.db
					.select({ space: table.spaceId })
					.from(table)
					.where(inArray(table.runId, runIds))
			: await sandbox.db
					.select({ space: table.spaceId })
					.from(table)
					.where(
						inArray(
							(table as typeof clone | typeof run | typeof keptVariable)
								.projectId,
							projectIds,
						),
					);
	return new Set(rows.map((r) => r.space));
};

const eventsOf = (runIds: string[]) =>
	sandbox.db
		.select()
		.from(event)
		.where(inArray(event.runId, runIds))
		.orderBy(asc(event.seq));

describe("spaceMoveBatch", () => {
	test("every row of a moved project takes the new Space: project, Clones, runs, steps, sessions, events and kept variables", async () => {
		await seed({ hostedRow: true });
		await runMove();

		const [mine] = await sandbox.db
			.select()
			.from(project)
			.where(eq(project.id, "mine"));
		expect(mine?.spaceId).toBe(to);
		for (const table of [clone, run, step, agentSession, keptVariable]) {
			expect(await spacesOf(table, ["mine", "hosted"])).toEqual(new Set([to]));
		}
		const events = await sandbox.db
			.select({ space: event.spaceId, runId: event.runId, type: event.type })
			.from(event);
		for (const e of events) {
			const stays = e.runId === "r-stay" || e.type === "MemberJoined";
			expect(e.space).toBe(stays ? from : to);
		}
	});

	test("a project that is not moved stays, with every row of it", async () => {
		await seed({ hostedRow: true });
		await runMove();

		const [stay] = await sandbox.db
			.select()
			.from(project)
			.where(eq(project.id, "stay"));
		expect(stay?.spaceId).toBe(from);
		for (const table of [clone, run, step, agentSession]) {
			expect(await spacesOf(table, ["stay"])).toEqual(new Set([from]));
		}
		expect(new Set((await eventsOf(["r-stay"])).map((e) => e.spaceId))).toEqual(
			new Set([from]),
		);
	});

	test("a project whose remote the new Space has maps onto that project: its rows go to it, and its own row goes", async () => {
		await seed({ hostedRow: true });
		await runMove();

		const projects = await sandbox.db
			.select({
				id: project.id,
				spaceId: project.spaceId,
				remote: project.remote,
			})
			.from(project)
			.orderBy(asc(project.id));
		expect(projects).toEqual([
			{ id: "hosted", spaceId: to, remote: "github.com/acme/app" },
			{ id: "mine", spaceId: to, remote: "github.com/acme/mine" },
			{ id: "stay", spaceId: from, remote: "github.com/acme/stay" },
		]);
		// The runs of both sides stay under the one project.
		const runs = await sandbox.db
			.select({ id: run.id })
			.from(run)
			.where(eq(run.projectId, "hosted"))
			.orderBy(asc(run.id));
		expect(runs.map((r) => r.id)).toEqual(["r-dup", "r-hosted"]);
		// A Device keeps one Clone of a project: the one the new Space knows.
		const clones = await sandbox.db
			.select({ id: clone.id, deviceId: clone.deviceId })
			.from(clone)
			.where(eq(clone.projectId, "hosted"))
			.orderBy(asc(clone.id));
		expect(clones).toEqual([
			{ id: "c-dup", deviceId: walker },
			{ id: "c-hosted-studio", deviceId: STUDIO },
		]);
		// The facts that named it name the project it maps onto.
		const named = await sandbox.db
			.select({ type: event.type, payload: event.payload })
			.from(event)
			.where(
				inArray(event.type, ["ProjectAdded", "ScheduleFired", "RunStarted"]),
			);
		const projectIds = named.map(
			(e) => (JSON.parse(e.payload) as { projectId: string }).projectId,
		);
		expect(projectIds).not.toContain("dup");
		expect(
			named
				.filter((e) => e.type === "ScheduleFired")
				.map((e) => JSON.parse(e.payload)),
		).toEqual([
			{
				projectId: "hosted",
				scheduleId: "nightly",
				at: 1,
				runId: "r-dup",
				error: null,
			},
		]);
	});

	test("a project of the new Space that this Replica has no row of yet gets one, with the remote", async () => {
		await seed({ hostedRow: false });
		await runMove();

		const [hosted] = await sandbox.db
			.select()
			.from(project)
			.where(eq(project.id, "hosted"));
		expect(hosted).toMatchObject({
			spaceId: to,
			name: "dup",
			remote: "github.com/acme/app",
		});
		const [dup] = await sandbox.db
			.select()
			.from(project)
			.where(eq(project.id, "dup"));
		expect(dup).toBeUndefined();
		expect(
			(
				await sandbox.db
					.select()
					.from(clone)
					.where(eq(clone.projectId, "hosted"))
			).length,
		).toBe(2);
	});

	test("a kept variable that both projects have keeps the latest write", async () => {
		await seed({ hostedRow: true });
		await runMove();

		const rows = await sandbox.db
			.select({ name: keptVariable.name, value: keptVariable.value })
			.from(keptVariable)
			.where(eq(keptVariable.projectId, "hosted"))
			.orderBy(asc(keptVariable.name));
		expect(rows).toEqual([
			{ name: "newer-here", value: JSON.stringify("dup") },
			{ name: "newer-there", value: JSON.stringify("hosted") },
			{ name: "only-here", value: JSON.stringify("dup") },
		]);
	});

	test("this computer's moved events take the numbers after its latest that stays, in their order", async () => {
		await seed({ hostedRow: true });
		const before = await sandbox.db
			.select()
			.from(event)
			.orderBy(asc(event.seq));
		const movedSeqs = new Set(
			before
				.filter(
					(e) =>
						e.runId === "r-mine" ||
						e.runId === "r-dup" ||
						e.type === "ProjectAdded" ||
						e.type === "ScheduleFired",
				)
				.map((e) => e.seq),
		);
		const staying = before.filter((e) => !movedSeqs.has(e.seq));
		const latestStaying = Math.max(...staying.map((e) => e.walkerSeq));

		await runMove();

		const after = await sandbox.db.select().from(event).orderBy(asc(event.seq));
		// The events that stay keep their numbers.
		for (const e of staying) {
			expect(after.find((a) => a.seq === e.seq)?.walkerSeq).toBe(e.walkerSeq);
		}
		// The moved ones follow them, one after the other, in their old order.
		expect(
			after.filter((e) => movedSeqs.has(e.seq)).map((e) => e.walkerSeq),
		).toEqual([...movedSeqs].map((_, index) => latestStaying + 1 + index));
		// The next event of this computer comes after all of them.
		const next = await log.append({
			type: "ProjectRenamed",
			payload: { projectId: "mine", name: "mine" },
		});
		const [row] = await sandbox.db
			.select({ walkerSeq: event.walkerSeq })
			.from(event)
			.where(eq(event.seq, next.seq));
		expect(row?.walkerSeq).toBe(latestStaying + movedSeqs.size + 1);
	});

	test("the exchange finds the moved events after the cursor its Host has of the new Space", async () => {
		await seed({ hostedRow: true });
		const landed = createLandedFeed({ db: sandbox.db, log });
		const history = createRunHistory({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			log,
			bus: createRunBus(),
			landed,
		});
		// The Host has every event of this computer in the new Space.
		const hostedEvents = await eventsOf(["r-hosted"]);
		const cursor = Math.max(...hostedEvents.map((e) => e.walkerSeq));
		const cursors = { [to]: { [walker]: cursor } };
		expect(
			(await history.rowsAfter({ spaces: [to], cursors, only: walker })).rows
				.events,
		).toEqual([]);

		await runMove();
		// What a move logs once its rows moved: the feed counts them again.
		await log.append({
			type: "ProjectMoved",
			payload: { projectId: "mine", from, to },
		});

		const { rows } = await history.rowsAfter({
			spaces: [to],
			cursors,
			only: walker,
		});
		expect(rows.runs.map((r) => r.id).sort()).toEqual(["r-dup", "r-mine"]);
		expect(rows.events.map((e) => e.type)).toEqual([
			"RunStarted",
			"WalkerMoved",
			"RunStarted",
			"WalkerMoved",
		]);
		landed.close();
	});

	test("without this computer, the moved events keep their numbers", async () => {
		await seed({ hostedRow: true });
		const before = await eventsOf(["r-mine", "r-dup"]);
		await runMove(move({ walkerId: undefined }));
		const after = await eventsOf(["r-mine", "r-dup"]);
		expect(after.map((e) => e.walkerSeq)).toEqual(
			before.map((e) => e.walkerSeq),
		);
	});

	test("another Walker's events keep their numbers", async () => {
		await seed({ hostedRow: true });
		await sandbox.db.insert(event).values({
			spaceId: from,
			runId: "r-mine",
			type: "StepEnded",
			payload: "{}",
			walkerId: STUDIO,
			walkerSeq: 7,
		});
		await runMove();
		const [theirs] = await sandbox.db
			.select()
			.from(event)
			.where(eq(event.walkerId, STUDIO));
		expect(theirs).toMatchObject({ spaceId: to, walkerSeq: 7 });
	});

	test("the Person fields of the moved rows take the Person's id in the new Space", async () => {
		await seed({ hostedRow: true });
		await runMove();

		const startedBy = async (runId: string) =>
			(
				await sandbox.db
					.select({ startedBy: run.startedBy })
					.from(run)
					.where(eq(run.id, runId))
			)[0]?.startedBy;
		expect(await startedBy("r-mine")).toBe(HOSTED);
		expect(await startedBy("r-dup")).toBe(HOSTED);
		expect(await startedBy("r-stay")).toBe(LOCAL);

		const payloads = async (runIds: string[]) =>
			(await eventsOf(runIds)).map(
				(e) => JSON.parse(e.payload) as { startedBy?: string; by?: string },
			);
		for (const payload of await payloads(["r-mine", "r-dup"])) {
			expect(payload.startedBy ?? payload.by).toBe(HOSTED);
		}
		for (const payload of await payloads(["r-stay", "r-hosted"])) {
			expect(payload.startedBy ?? payload.by).toBe(LOCAL);
		}
		// A fact of the Space itself does not move.
		const [joined] = await sandbox.db
			.select()
			.from(event)
			.where(eq(event.type, "MemberJoined"));
		expect(joined?.spaceId).toBe(from);
		expect(JSON.parse(joined?.payload ?? "{}").personId).toBe(LOCAL);
	});

	test("with one Walker's runs, the runs another Walker walks stay, with their steps, sessions and events", async () => {
		await seed({ hostedRow: false });
		await sandbox.db.insert(run).values({
			id: "r-theirs",
			spaceId: from,
			projectId: "mine",
			flow: "{}",
			title: "theirs",
			worktreePath: "/w/theirs",
			branch: "theirs",
			baseRef: "main",
			walkerId: STUDIO,
			startedBy: LOCAL,
		});
		await sandbox.db.insert(step).values({
			id: "r-theirs-step",
			spaceId: from,
			runId: "r-theirs",
			nodeId: "n1",
			nodeType: "agent",
			visit: 1,
			transcriptPath: "/t/theirs",
		});
		await sandbox.db.insert(event).values({
			spaceId: from,
			runId: "r-theirs",
			type: "StepEnded",
			payload: "{}",
			walkerId: STUDIO,
			walkerSeq: 1,
		});

		await runMove({
			from,
			to,
			projectMap: { mine: "mine" },
			personMap: { [LOCAL]: HOSTED },
			runsOf: walker,
		});

		const rowOf = async (id: string) =>
			(await sandbox.db.select().from(run).where(eq(run.id, id)))[0];
		expect(await rowOf("r-mine")).toMatchObject({
			spaceId: to,
			startedBy: HOSTED,
		});
		expect(await rowOf("r-theirs")).toMatchObject({
			spaceId: from,
			projectId: "mine",
			startedBy: LOCAL,
		});
		const [theirStep] = await sandbox.db
			.select()
			.from(step)
			.where(eq(step.runId, "r-theirs"));
		expect(theirStep?.spaceId).toBe(from);
		expect(
			(await eventsOf(["r-theirs"])).map((e) => [e.spaceId, e.walkerSeq]),
		).toEqual([[from, 1]]);
		expect(new Set((await eventsOf(["r-mine"])).map((e) => e.spaceId))).toEqual(
			new Set([to]),
		);
		expect(await spacesOf(clone, ["mine"])).toEqual(new Set([to]));
		expect(await spacesOf(keptVariable, ["mine"])).toEqual(new Set([to]));
	});

	test("a move of one Walker's runs keeps every project's id", async () => {
		await seed({ hostedRow: true });
		await expect(
			spaceMoveBatch(sandbox.db, move({ runsOf: walker })),
		).rejects.toThrow("keeps every Project's id");
	});

	test("the batch is one unit: when a statement fails, nothing moved", async () => {
		await seed({ hostedRow: true });
		const snapshot = async () => ({
			projects: await sandbox.db
				.select()
				.from(project)
				.orderBy(asc(project.id)),
			runs: await sandbox.db.select().from(run).orderBy(asc(run.id)),
			events: await sandbox.db.select().from(event).orderBy(asc(event.seq)),
			clones: await sandbox.db.select().from(clone).orderBy(asc(clone.id)),
			kept: await sandbox.db
				.select()
				.from(keptVariable)
				.orderBy(asc(keptVariable.projectId), asc(keptVariable.name)),
		});
		const before = await snapshot();
		const statements = await spaceMoveBatch(sandbox.db, move());
		await expect(
			sandbox.db.batch([
				...statements,
				// A second project with a remote another one has.
				sandbox.db.insert(project).values({
					id: "clash",
					spaceId: to,
					name: "clash",
					remote: "github.com/acme/mine",
				}),
			]),
		).rejects.toThrow();
		expect(await snapshot()).toEqual(before);
	});

	test("a project that is not in the Space it moves from is refused", async () => {
		await seed({ hostedRow: true });
		await expect(
			spaceMoveBatch(sandbox.db, move({ projectMap: { hosted: "hosted" } })),
		).rejects.toThrow("is not in the Space");
		await expect(
			spaceMoveBatch(sandbox.db, move({ projectMap: { nowhere: "nowhere" } })),
		).rejects.toThrow("is not in the Space");
	});

	test("a project cannot map onto one of another Space, or of another remote", async () => {
		await seed({ hostedRow: true });
		await expect(
			spaceMoveBatch(
				sandbox.db,
				move({ projectMap: { mine: "mine", dup: "mine" } }),
			),
		).rejects.toThrow("both moves");
		await addProject("elsewhere", await otherSpace(sandbox.db, "Team"), null);
		await expect(
			spaceMoveBatch(sandbox.db, move({ projectMap: { dup: "elsewhere" } })),
		).rejects.toThrow("is not in the Space");
		await sandbox.db
			.update(project)
			.set({ remote: "github.com/acme/other" })
			.where(eq(project.id, "hosted"));
		await expect(
			spaceMoveBatch(sandbox.db, move({ projectMap: { dup: "hosted" } })),
		).rejects.toThrow("their remotes differ");
	});
});
