import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { event, organization, project, user } from "@nightshift/db/schema";
import type { MoveRows, WalkRef } from "@nightshift/engine";
import {
	createRunLog,
	createSandbox,
	type RunLog,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { eq, max } from "drizzle-orm";
import type { HostRelay } from "../contract";
import { withPeers } from "../testing";
import { createPeerEngine, type PeerEngine } from "./peer-engine";

/**
 * The engine of a Device among its peers (`createPeerEngine`): the
 * engine, wired to this package's Device rows, with the devices' half
 * beside it. What the wiring decides: a Space a Host keeps is not this
 * computer's to change, a Space move takes the Commands of its runs
 * along, the Members of a Space come from its document, and a disposed
 * engine takes over no run that still moves here.
 */

let a: Sandbox;
let b: Sandbox;
/** The engines a test made: disposed after it. */
let engines: PeerEngine[];

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	engines = [];
});
afterEach(async () => {
	await Promise.all(engines.map((engine) => engine.dispose()));
	await Promise.all([a.cleanup(), b.cleanup()]);
});

/** A command, then a Gate: the run waits with a step that has a transcript. */
const gateFlow: Flow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello",
			output: "text",
		},
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "approve" }, { name: "reject" }],
			by: "person",
			decider: "typesafe",
		},
	],
	edges: [{ id: "e1", from: "hello", outcome: "pass", to: "ship" }],
} as Flow;

function engineOf(
	sandbox: Sandbox,
	options: { relay?: HostRelay; moveRows?: MoveRows[]; runLog?: RunLog } = {},
): PeerEngine {
	const engine = createPeerEngine(
		withPeers({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			...(options.relay ? { relay: options.relay } : {}),
			...(options.moveRows ? { moveRows: options.moveRows } : {}),
		}),
		{
			runLog:
				options.runLog ??
				createRunLog(sandbox.db, { walkerId: sandbox.deviceId }),
		},
	);
	engines.push(engine);
	return engine;
}

/** A's run of `gateFlow` in its own Space, waiting at its Gate. */
async function waitingRun(engine: PeerEngine, projectId: string) {
	const space = engine.space(a.spaceId);
	const { id } = await space.startRun({ projectId, flow: gateFlow });
	await waitFor(async () => (await space.getRun(id)).status === "waiting", {
		label: "the Gate",
	});
	return id;
}

/** Another Space on the Replica, as the organization plugin stores it. */
async function otherSpace(sandbox: Sandbox, name: string): Promise<string> {
	const id = `space-${name.toLowerCase()}`;
	await sandbox.db
		.insert(organization)
		.values({ id, name, slug: id, createdAt: new Date() });
	return id;
}

describe("a Device's engine among its peers", () => {
	test("a Space a Host lists is the Host's: no Project moves into it here", async () => {
		const engine = engineOf(a);
		const app = await engine
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		const [owner] = await a.db.select().from(user);
		await engine.hostSpaces.update(
			{ id: "host-1", name: "Studio" },
			[{ id: "space-studio", name: "Studio", personal: false, role: "owner" }],
			owner?.id as string,
		);

		await expect(
			engine.space(a.spaceId).moveProject(app.id, "space-studio"),
		).rejects.toThrow("This Space is kept by another computer.");
		expect(
			(await engine.space(a.spaceId).listProjects()).map((p) => p.id),
		).toEqual([app.id]);
	});

	test("a Space move takes the Commands of its runs along, beside the rows of the packages above", async () => {
		const asked: Parameters<MoveRows>[0][] = [];
		const engine = engineOf(a, {
			moveRows: [
				async (runs) => {
					asked.push(runs);
					return [];
				},
			],
		});
		const platform = await otherSpace(a, "Platform");
		const app = await engine
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		const runId = await waitingRun(engine, app.id);
		await engine.space(a.spaceId).act(runId, { kind: "stop" });
		const { commands } = engine.exchange;
		// A Command for the run that moves, and one for a run that stays.
		const moving = await commands.enqueue({
			kind: "signal.send",
			payload: { name: "go" },
			spaceId: a.spaceId,
			runId,
			walkerId: "device-b",
			personId: "person-here",
		});
		const staying = await commands.enqueue({
			kind: "run.stop",
			payload: {},
			spaceId: a.spaceId,
			runId: "a-run-that-stays",
			walkerId: "device-b",
			personId: "person-here",
		});

		await engine.moveProjects({
			from: a.spaceId,
			plan: async () => ({
				projects: { [app.id]: { spaceId: platform, projectId: app.id } },
				personMap: { "person-here": "person-there" },
			}),
		});

		// The Walker applies a Command in the Space it names: the run's new one,
		// as the Person who asked is named there.
		expect(await commands.pendingFor("device-b")).toEqual([
			{ ...moving, spaceId: platform, personId: "person-there" },
			staying,
		]);
		expect(asked).toEqual([
			{
				from: a.spaceId,
				to: platform,
				runIds: [runId],
				personMap: { "person-here": "person-there" },
			},
		]);
	});

	test("the Members of a Space come from its document", async () => {
		const engine = engineOf(a);
		const [owner] = await a.db.select().from(user);
		const ownerId = owner?.id as string;
		expect(await engine.members.role(a.spaceId, ownerId)).toBe("owner");
		expect(await engine.members.name(a.spaceId, ownerId)).toBe(
			owner?.name as string,
		);
		expect(await engine.members.role(a.spaceId, "a-stranger")).toBeNull();
		expect(await engine.members.name(a.spaceId, "a-stranger")).toBeNull();
	});
});

describe("a disposed engine", () => {
	/** A relay whose archive answers from `files`. */
	function relayOf(files: () => Map<string, string>): HostRelay {
		return {
			command: async () => {},
			addClone: async () => {},
			reachable: async () => false,
			archiveGet: async (ref) =>
				ref.kind === "content" ? null : (files().get(fileKey(ref)) ?? null),
			archivePut: async () => true,
			inStep: async () => "in step" as const,
			startRun: async () => {
				throw new Error("not in this test");
			},
			offer: async () => {},
			withdrawOffer: async () => {},
			devices: async () => [],
		};
	}

	const fileKey = (ref: WalkRef) =>
		ref.kind === "checkpoint" ? ref.kind : `${ref.kind}:${ref.stepId}`;

	/** The types of the run's events on B, as `walker:type`. */
	async function typesOnB(runId: string) {
		return (
			await b.db
				.select()
				.from(event)
				.where(eq(event.runId, runId))
				.orderBy(event.seq)
		).map((e) => `${e.walkerId}:${e.type}`);
	}

	test("tries no more to take over a run that moves here: the next engine takes it over", async () => {
		const logA = createRunLog(a.db, { walkerId: a.deviceId });
		const engineA = engineOf(a, { runLog: logA });
		let archive = new Map<string, string>();
		const relay = relayOf(() => archive);
		const before = engineOf(b, { relay });
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		const [row] = await a.db
			.select()
			.from(project)
			.where(eq(project.id, projectId));
		await b.db.insert(project).values(row as typeof project.$inferSelect);
		const runId = await waitingRun(engineA, projectId);

		// A moves its run to B, as a move does: its walk state into the
		// archive, then `WalkerMoved` as its last event (a fixture, past A's engine).
		const files = new Map<string, string>();
		const refs: WalkRef[] = [
			{ kind: "checkpoint", spaceId: a.spaceId, runId },
			...(await engineA.space(a.spaceId).getRun(runId)).steps.map(
				(s): WalkRef => ({
					kind: "transcript",
					spaceId: a.spaceId,
					runId,
					stepId: s.id,
				}),
			),
		];
		for (const ref of refs) {
			const content = await engineA.exchange.archive.own(ref);
			if (content !== null) files.set(fileKey(ref), content);
		}
		const [counted] = await a.db
			.select({ latest: max(event.walkerSeq) })
			.from(event)
			.where(eq(event.walkerId, a.deviceId));
		await logA.ingest([
			{
				spaceId: a.spaceId,
				runId,
				stepId: null,
				sessionId: null,
				type: "WalkerMoved",
				payload: JSON.stringify({ from: a.deviceId, to: b.deviceId, by: null }),
				at: Date.now(),
				walkerId: a.deviceId,
				walkerSeq: (counted?.latest ?? 0) + 1,
			},
		]);
		const { rows } = await engineA.exchange.rowsAfter({
			spaces: [a.spaceId],
			cursors: {},
			except: b.deviceId,
		});
		// The archive does not have the run's walk state yet: B says so, and
		// tries again later.
		const said = spyOn(console, "error").mockImplementation(() => {});
		const tries = () =>
			said.mock.calls.filter((call) =>
				String(call[0]).includes(`run ${runId} moved here`),
			).length;
		try {
			await before.exchange.ingest(rows);
			await waitFor(async () => tries() === 1, { label: "the first try" });
			await before.dispose();

			// Past the first wait before the next try, the disposed engine
			// tried nothing more, though the archive has the run now.
			archive = files;
			await Bun.sleep(2_500);
			expect(tries()).toBe(1);
			expect(await typesOnB(runId)).not.toContain(
				`${b.deviceId}:WalkerArrived`,
			);
		} finally {
			said.mockRestore();
		}

		engineOf(b, { relay });
		await waitFor(
			async () =>
				(await typesOnB(runId)).at(-1) === `${b.deviceId}:WalkerArrived`,
			{ label: "the run to arrive", timeoutMs: 15_000 },
		);
	});
});
