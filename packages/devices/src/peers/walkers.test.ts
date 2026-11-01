import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { project, user } from "@nightshift/db/schema";
import type { RunWalker } from "@nightshift/engine";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "@nightshift/engine/projects";
import {
	createRunLog,
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { withPeers } from "../testing";
import { deviceDirectory } from "./directory";
import { createPeerEngine, type PeerEngine } from "./peer-engine";

/**
 * The Walker a run view names (`walkers.ts`, the peers' `runs.walkers`):
 * A walks a run that waits at its Gate, and B gets it by cursor. Each
 * view of the run (the run list, the run, the open Gates) names its
 * Walker the same way: this computer by its own name, another Device by
 * its row here, else by the Space document, else by its id alone.
 */

let a: Sandbox;
let b: Sandbox;
/** B's Space documents: where a Space names the Devices of its Clones. */
let documentsB: SpaceDocuments;
let engineA: PeerEngine;
let engineB: PeerEngine;
let runId: string;

const HOST = "the-host";

/** A Gate: the run waits, so the open Gates name its Walker too. */
const gateFlow: Flow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "ship",
	nodes: [
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
	edges: [],
} as Flow;

function engineOf(sandbox: Sandbox, documents?: SpaceDocuments): PeerEngine {
	return createPeerEngine(
		withPeers({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			...(documents ? { spaceDocuments: documents } : {}),
		}),
		{ runLog: createRunLog(sandbox.db, { walkerId: sandbox.deviceId }) },
	);
}

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	documentsB = createSpaceDocuments({
		db: b.db,
		directory: deviceDirectory(b.db),
	});
	engineA = engineOf(a);
	engineB = engineOf(b, documentsB);
	const { id: projectId } = await engineA
		.space(a.spaceId)
		.addProject({ repoPath: a.repoPath });
	// B gets A's project row, as the Space document would bring it.
	const [row] = await a.db
		.select()
		.from(project)
		.where(eq(project.id, projectId));
	if (!row) throw new Error("A has no project.");
	await b.db.insert(project).values(row);
	runId = (
		await engineA.space(a.spaceId).startRun({ projectId, flow: gateFlow })
	).id;
	await waitFor(
		async () =>
			(await engineA.space(a.spaceId).getRun(runId)).status === "waiting",
		{ label: "the Gate" },
	);
	// A's rows into B, by cursor, as the exchange brings them.
	const { rows } = await engineA.exchange.rowsAfter({
		spaces: [a.spaceId],
		cursors: await engineB.exchange.cursorsWith(HOST),
		except: b.deviceId,
	});
	await engineB.exchange.ingest(rows);
});

afterEach(async () => {
	await Promise.all([engineA.dispose(), engineB.dispose()]);
	await documentsB.flush();
	await Promise.all([a.cleanup(), b.cleanup()]);
});

/** The Walker each view of the run on `engine` names: the run list, the run, its open Gate. */
async function walkersOn(engine: PeerEngine): Promise<(RunWalker | null)[]> {
	const space = engine.space(a.spaceId);
	const listed = (await space.listRuns()).find((r) => r.id === runId);
	const gate = (await space.listGates()).find((g) => g.runId === runId);
	return [
		listed?.walker ?? null,
		(await space.getRun(runId)).walker,
		gate?.walker ?? null,
	];
}

/** B's document of A's Space names A's Device, as it does for the Device of a Clone. */
async function namedInDocument(name: string) {
	const document = await documentsB.open(a.spaceId);
	await document.change(() =>
		document.devices.set(a.deviceId, { name, updatedAt: now() }),
	);
}

describe("the Walker a run view names", () => {
	test("this computer's run: this computer, by its own name", async () => {
		const self = { id: a.deviceId, name: "test", thisDevice: true };
		expect(await walkersOn(engineA)).toEqual([self, self, self]);
	});

	test("a Device nobody here names: its id, without a name", async () => {
		const other = { id: a.deviceId, name: null, thisDevice: false };
		expect(await walkersOn(engineB)).toEqual([other, other, other]);
	});

	test("a Device without a row here: the name the Space document has for it", async () => {
		await namedInDocument("Studio");
		const other = { id: a.deviceId, name: "Studio", thisDevice: false };
		expect(await walkersOn(engineB)).toEqual([other, other, other]);
	});

	test("a Device paired with this Host: the name of its row, before the Space document's", async () => {
		await namedInDocument("Studio");
		const [owner] = await b.db.select().from(user);
		// A pairs with B, through the registry B's engine shows.
		await engineB.devices.join({
			id: a.deviceId,
			name: "Ada's laptop",
			platform: "test",
			ownerId: owner?.id as string,
			homeHost: null,
		});
		const other = { id: a.deviceId, name: "Ada's laptop", thisDevice: false };
		expect(await walkersOn(engineB)).toEqual([other, other, other]);

		// Its access removed, its runs keep its name.
		await engineB.devices.revoke(a.deviceId);
		expect(await walkersOn(engineB)).toEqual([other, other, other]);
	});
});
