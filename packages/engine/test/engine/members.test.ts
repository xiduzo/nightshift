import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { device, event, user } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { and, eq } from "drizzle-orm";
import { NIGHT_SHIFT } from "../../src/contract";
import type { Engine } from "../../src/engine";
import { parseEventRow } from "../../src/log/run-log/append";
import { createRunLog, type RunLog } from "../../src/log/run-log/run-log";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "../../src/projects/space-document";
import { git } from "../../src/projects/worktrees";
import { aloneDirectory } from "../../src/testing/alone-directory";
import {
	createSandbox,
	expectRunLogsInSync,
	mustGit,
	type Sandbox,
	waitFor,
	withDevice,
} from "../../src/testing/test-support";
import { createEngine } from "../../src/wire";

/**
 * Members: the Person who started a run, and their git identity in its
 * worktree. A run without a Person is the owner's (`runs/start/application/start-run-here.test.ts`).
 * The audit of a Space's Members is `log/space-facts/member-events.test.ts`.
 */

let sandbox: Sandbox;
let runLogs: RunLog[];
let signal: AbortController;
let documents: SpaceDocuments;
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
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
		await documents.flush();
		await sandbox.cleanup();
	}
});

function makeEngine(): Engine {
	const runLog = createRunLog(sandbox.db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			spaceDocuments: documents,
		}),
		{ runLog, signal: signal.signal },
	);
}

/** A Gate only: the run waits, and nothing touches the worktree. */
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "ship",
	nodes: [
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "yes" }, { name: "no" }],
			by: "person",
			decider: "typesafe",
		},
	],
	edges: [],
};

async function person(name: string, email: string): Promise<string> {
	const id = `person-${name.toLowerCase()}`;
	await sandbox.db.insert(user).values({ id, name, email, role: "user" });
	return id;
}

async function localPersonId(): Promise<string> {
	const [self] = await sandbox.db
		.select({ ownerId: device.ownerId })
		.from(device)
		.where(eq(device.self, true));
	if (!self?.ownerId) throw new Error("no local Person");
	return self.ownerId;
}

/** A value of the worktree's own config, else "". */
async function worktreeConfig(cwd: string, key: string): Promise<string> {
	return (await git(cwd, ["config", "--worktree", "--get", key])).stdout;
}

async function startAndWait(engine: Engine, startedBy?: string) {
	const space = engine.space(sandbox.spaceId, NIGHT_SHIFT);
	const project = await space.addProject({ repoPath: sandbox.repoPath });
	const started = await space.startRun({
		projectId: project.id,
		flow,
		...(startedBy ? { startedBy } : {}),
	});
	await waitFor(
		async () => (await space.getRun(started.id)).status === "waiting",
		{ label: "the Gate" },
	);
	return { space, started };
}

describe("who started a run", () => {
	test("RunStarted names the Person, the run shows them, and commits are in their name", async () => {
		const carol = await person("Carol", "carol@example.com");
		const engine = makeEngine();
		const { space, started } = await startAndWait(engine, carol);

		expect(started.startedBy).toEqual({ id: carol, name: "Carol" });
		expect((await space.getRun(started.id)).startedBy).toEqual({
			id: carol,
			name: "Carol",
		});
		expect((await space.listRuns())[0]?.startedBy).toEqual({
			id: carol,
			name: "Carol",
		});
		const [logged] = await sandbox.db
			.select()
			.from(event)
			.where(and(eq(event.runId, started.id), eq(event.type, "RunStarted")));
		const runStarted = logged ? parseEventRow(logged) : null;
		expect(
			runStarted?.type === "RunStarted" ? runStarted.payload.startedBy : null,
		).toBe(carol);

		// The worktree has Carol's identity; the clone keeps its own.
		const worktree = started.worktreePath;
		expect(await worktreeConfig(worktree, "user.name")).toBe("Carol");
		expect(await worktreeConfig(worktree, "user.email")).toBe(
			"carol@example.com",
		);
		expect(await worktreeConfig(sandbox.repoPath, "user.email")).toBe("");
		await Bun.write(`${worktree}/change.txt`, "change\n");
		await mustGit(worktree, ["add", "change.txt"]);
		await mustGit(worktree, [
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-q",
			"-m",
			"change",
		]);
		expect(await mustGit(worktree, ["log", "-1", "--format=%an <%ae>"])).toBe(
			"Carol <carol@example.com>",
		);
	});

	test("the Person of this computer, with no real email, leaves the repository's identity alone", async () => {
		const engine = makeEngine();
		const local = await localPersonId();
		const { started } = await startAndWait(engine, local);

		expect(started.startedBy?.id).toBe(local);
		expect(await worktreeConfig(started.worktreePath, "user.email")).toBe("");
		expect(await worktreeConfig(started.worktreePath, "user.name")).toBe("");
	});
});
