import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RoleRefusal } from "@nightshift/auth";
import { member, user } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { asDate } from "@nightshift/time";
import type { Engine } from "../../src/engine";
import { GateClosedError, NeedsApp } from "../../src/gates";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../../src/testing/test-support";
import { createEngine } from "../../src/wire";

/**
 * The Gate use cases of a whole engine (`Engine.gates`): the door the API
 * calls with the session's Person. The answer opens the run for the Person
 * and applies every rule, the lock-screen rule too (decision 77 of the
 * hexagon series). The inbox reads the Person's Spaces from the `member`
 * rows.
 */

let sandbox: Sandbox;
let engine: Engine;
let ownerId: string;
let projectId: string;
const signal = new AbortController();
beforeEach(async () => {
	sandbox = await createSandbox();
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
		}),
		{ signal: signal.signal },
	);
	const [owner] = await sandbox.db.select().from(user);
	ownerId = owner?.id as string;
	projectId = (
		await engine
			.space(sandbox.spaceId)
			.addProject({ repoPath: sandbox.repoPath })
	).id;
});
afterEach(async () => {
	await engine.dispose();
	await sandbox.cleanup();
});

/** A command, then a Gate a person answers, marked for the lock screen when `lockScreen`. */
const gateFlow = (lockScreen: boolean): Flow =>
	({
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "hello",
		nodes: [
			{
				id: "hello",
				type: "command",
				position: { x: 0, y: 0 },
				command: "echo hello",
				stdout: "text",
			},
			{
				id: "ship",
				type: "decision",
				position: { x: 0, y: 0 },
				prompt: "Ship it?",
				options: [{ name: "approve" }, { name: "reject" }],
				by: "person",
				decider: "typesafe",
				lockScreen,
			},
		],
		edges: [{ id: "e1", from: "hello", outcome: "pass", to: "ship" }],
	}) as Flow;

/** A run of the sandbox's Space that waits at its Gate, and the Gate. */
async function waitingRun(lockScreen: boolean) {
	const view = engine.space(sandbox.spaceId);
	const started = await view.startRun({
		projectId,
		flow: gateFlow(lockScreen),
	});
	const gate = await waitFor(
		async () => (await view.listGates()).find((g) => g.runId === started.id),
		{ timeoutMs: 15_000 },
	);
	return { runId: started.id, stepId: gate.stepId };
}

const statusOf = async (runId: string) =>
	(await engine.space(sandbox.spaceId).getRun(runId)).status;

describe("the answer through Engine.gates", () => {
	test("from the lock screen, goes only to a Gate marked for it", async () => {
		const owner = { personId: ownerId };
		const plain = await waitingRun(false);
		const refused = await engine.gates
			.answer(owner, {
				runId: plain.runId,
				stepId: plain.stepId,
				choice: "approve",
				via: "lock_screen",
			})
			.then(
				() => null,
				(error: unknown) => error,
			);
		expect(refused).toBeInstanceOf(NeedsApp);
		expect(await statusOf(plain.runId)).toBe("waiting");

		const marked = await waitingRun(true);
		await engine.gates.answer(owner, {
			runId: marked.runId,
			stepId: marked.stepId,
			choice: "approve",
			via: "lock_screen",
		});
		await waitFor(async () => (await statusOf(marked.runId)) === "finished", {
			timeoutMs: 15_000,
		});
		// Answered: the lock screen finds it closed.
		await expect(
			engine.gates.answer(owner, {
				runId: marked.runId,
				stepId: marked.stepId,
				choice: "approve",
				via: "lock_screen",
			}),
		).rejects.toBeInstanceOf(GateClosedError);
	});

	test("refuses a viewer of the Space", async () => {
		await sandbox.db
			.insert(user)
			.values({ id: "u-vic", name: "Vic", email: "vic@example.invalid" });
		await sandbox.db.insert(member).values({
			id: "m-vic",
			organizationId: sandbox.spaceId,
			userId: "u-vic",
			role: "viewer",
			createdAt: asDate(),
		});
		const { runId, stepId } = await waitingRun(false);
		await expect(
			engine.gates.answer(
				{ personId: "u-vic" },
				{ runId, stepId, choice: "approve" },
			),
		).rejects.toBeInstanceOf(RoleRefusal);
		expect(await statusOf(runId)).toBe("waiting");
	});
});

describe("the inbox through Engine.gates", () => {
	test("lists the open Gates of the Person's Spaces, and none for a Person of no Space", async () => {
		const { runId } = await waitingRun(false);
		const inbox = await engine.gates.inbox({ personId: ownerId });
		expect(inbox.map((g) => [g.runId, g.spaceId, g.canAnswer])).toEqual([
			[runId, sandbox.spaceId, true],
		]);
		expect(await engine.gates.inbox({ personId: "nobody" })).toEqual([]);
		expect(await engine.gates.answeredInbox({ personId: ownerId })).toEqual([]);
	});
});
