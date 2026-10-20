import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { device, event, user } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { and, eq, isNull } from "drizzle-orm";
import type { Engine } from "../contract/engine";
import { parseEventRow } from "../log/events";
import { createRunLog, type RunLog } from "../log/run-log";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "../projects/space-document";
import { git } from "../projects/worktrees";
import {
	createSandbox,
	expectRunLogsInSync,
	mustGit,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";

/**
 * Members: the Person who started a run, their git identity in its
 * worktree, and the audit of a Space's Members in its event log.
 */

let sandbox: Sandbox;
let runLogs: RunLog[];
let signal: AbortController;
let documents: SpaceDocuments;
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
	signal = new AbortController();
	documents = createSpaceDocuments({ db: sandbox.db });
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

function makeEngine(): Engine {
	const runLog = createRunLog(sandbox.db);
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
	version: 5,
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
	const space = engine.space(sandbox.spaceId);
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

	test("a run without a Person (a schedule) names nobody", async () => {
		const engine = makeEngine();
		const { started } = await startAndWait(engine);
		expect(started.startedBy).toBeNull();
	});
});

describe("the audit of Members", () => {
	test("joined, new role and removed go in the Space's log, with who did it", async () => {
		const engine = makeEngine();
		const carol = await person("Carol", "carol@example.com");
		const ada = await localPersonId();
		const spaceId = sandbox.spaceId;

		await engine.logMemberChange({
			kind: "joined",
			spaceId,
			personId: carol,
			role: "member",
			by: carol,
			invitedBy: ada,
		});
		await engine.logMemberChange({
			kind: "role",
			spaceId,
			personId: carol,
			role: "viewer",
			previousRole: "member",
			by: ada,
		});
		await engine.logMemberChange({
			kind: "removed",
			spaceId,
			personId: carol,
			by: ada,
		});

		const rows = await sandbox.db
			.select()
			.from(event)
			.where(and(eq(event.spaceId, spaceId), isNull(event.runId)));
		const facts = rows
			.map(parseEventRow)
			.filter((e) => e.type.startsWith("Member"))
			.map((e) => ({ type: e.type, payload: e.payload }));
		expect(facts).toEqual([
			{
				type: "MemberJoined",
				payload: { personId: carol, role: "member", by: carol, invitedBy: ada },
			},
			{
				type: "MemberRoleChanged",
				payload: {
					personId: carol,
					role: "viewer",
					previousRole: "member",
					by: ada,
				},
			},
			{ type: "MemberRemoved", payload: { personId: carol, by: ada } },
		]);
	});
});
