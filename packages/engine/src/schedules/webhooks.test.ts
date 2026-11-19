import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { fakeHarness } from "@nightshift/agents/testing";
import { event } from "@nightshift/db/schema";
import type { Flow, Schedule } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { NIGHT_SHIFT } from "../contract";
import type { Engine } from "../engine";
import { parseEventRow } from "../log/run-log/append";
import type { SpaceEngine } from "../space-engine";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "../wire";

/** Webhook schedules: a signed request starts a run, sends a signal, or is refused. */

const SECRET = "s3cret";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

let sandbox: Sandbox;
let controller: AbortController;
let engine: Engine;
let space: SpaceEngine;
let projectId: string;
let secretAsked: string[];

beforeEach(async () => {
	sandbox = await createSandbox();
	secretAsked = [];
	controller = new AbortController();
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			secret: async (name, project) => {
				secretAsked.push(project.projectId);
				return name === "HOOK_SECRET" ? SECRET : undefined;
			},
		}),
		{ signal: controller.signal },
	);
	space = engine.space(sandbox.spaceId, NIGHT_SHIFT);
	projectId = (await space.addProject({ repoPath: sandbox.repoPath })).id;
});
afterEach(async () => {
	controller.abort();
	await sandbox.cleanup();
});

const echoFlow: Flow = {
	version: FLOW_VERSION,
	inputs: [
		{ name: "pr", type: "text" },
		{ name: "body", type: "json" },
	],
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "command",
			position: { x: 0, y: 0 },
			command: 'echo "{{pr}}"',
			stdout: "text",
		},
	],
	edges: [],
};

/** Waits for the signal `ci-done` with the run's own `pr` as the key. */
const waitFlow: Flow = {
	version: FLOW_VERSION,
	inputs: [{ name: "pr", type: "text" }],
	outputs: [],
	start: "ci",
	nodes: [
		{
			id: "ci",
			type: "wait",
			position: { x: 0, y: 0 },
			until: { kind: "signal", name: "ci-done", key: "{{pr}}" },
		},
	],
	edges: [],
};

/** Waits for `ci-done` with the key `pr`, and ends green or red by the event. */
const ruledFlow: Flow = {
	...waitFlow,
	nodes: [
		{
			id: "ci",
			type: "wait",
			position: { x: 0, y: 0 },
			until: { kind: "signal", name: "ci-done", key: "{{pr}}" },
			outcomes: [
				{ name: "green", when: 'event.body.conclusion = "success"' },
				{ name: "red", when: 'event.body.conclusion = "failure"' },
			],
		},
	],
};

function hook(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "review",
		flow: "echo",
		inputs: {
			pr: "{{event.body.pull_request.number}}",
			body: "{{event.body}}",
		},
		webhook: { secret: HOOK_SECRET },
		enabled: true,
		...extra,
	};
}

async function setup(schedules: Schedule[]) {
	await seedFlows(
		space,
		projectId,
		{ echo: echoFlow, wait: waitFlow, ruled: ruledFlow },
		schedules,
	);
}

const body = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value));

/** A request as GitHub signs it, or with other headers. */
function signed(
	payload: Uint8Array,
	headers: Record<string, string> = {},
	secret = SECRET,
): Headers {
	return new Headers({
		"content-type": "application/json",
		"x-github-event": "pull_request",
		"x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
		...headers,
	});
}

async function send(
	payload: Uint8Array,
	headers: Headers,
	ids: { projectId?: string; scheduleId?: string } = {},
) {
	const { answer, done } = await engine.webhook({
		projectId: ids.projectId ?? projectId,
		scheduleId: ids.scheduleId ?? "review",
		headers,
		body: payload,
	});
	await done;
	return answer;
}

async function logged() {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(eq(event.type, "WebhookReceived"));
	return rows.map(parseEventRow);
}

describe("a webhook schedule", () => {
	test("starts its flow with inputs read from the event", async () => {
		await setup([hook()]);
		const payload = body({ action: "opened", pull_request: { number: 7 } });
		expect(await send(payload, signed(payload))).toEqual({ kind: "accepted" });

		const [run] = await space.listRuns();
		expect(run?.trigger).toEqual({
			kind: "webhook",
			scheduleId: "review",
			at: expect.any(Number),
		});
		expect(run?.inputs).toEqual({
			pr: "7",
			body: { action: "opened", pull_request: { number: 7 } },
		});

		const [received] = await logged();
		expect(received?.payload).toEqual({
			projectId,
			scheduleId: "review",
			at: expect.any(Number),
			result: "accepted",
			runId: run?.id ?? "",
			woke: 0,
			error: null,
		});

		const list = await space.listSchedules(projectId);
		expect(list.schedules[0]).toMatchObject({
			id: "review",
			nextAt: null,
			last: null,
			deliveries: [
				{ result: "accepted", runId: run?.id, reason: null, woke: 0 },
			],
		});
	});

	test("reads the secret for the schedule's project", async () => {
		await setup([hook()]);
		const payload = body({});
		await send(payload, signed(payload));
		expect(secretAsked).toEqual([projectId]);
	});

	test("its signal wakes the runs whose Wait has its key, with the event as data", async () => {
		await setup([
			{
				id: "ci",
				inputs: {},
				enabled: true,
				webhook: { secret: HOOK_SECRET },
				signal: { name: "ci-done", key: "event.body.number" },
			},
		]);
		const seven = await space.startRun({
			projectId,
			flowName: "wait",
			inputs: { pr: "7" },
		});
		const eight = await space.startRun({
			projectId,
			flowName: "wait",
			inputs: { pr: "8" },
		});
		const sleeping = async (runId: string) =>
			waitFor(
				async () =>
					(await space.getRun(runId)).status === "sleeping" ? true : null,
				{ label: "a sleeping run" },
			);
		await sleeping(seven.id);
		await sleeping(eight.id);

		const payload = body({ number: 7, conclusion: "success" });
		expect(await send(payload, signed(payload), { scheduleId: "ci" })).toEqual({
			kind: "accepted",
		});
		const done = await waitFor(
			async () => {
				const run = await space.getRun(seven.id);
				return run.status === "finished" ? run : null;
			},
			{ label: "the woken run" },
		);
		expect(done.steps[0]?.outputs.data).toEqual({
			body: { number: 7, conclusion: "success" },
			headers: {
				"content-type": "application/json",
				"x-github-event": "pull_request",
			},
		});
		expect((await space.getRun(eight.id)).status).toBe("sleeping");
		expect((await logged())[0]?.payload).toMatchObject({
			result: "accepted",
			runId: null,
			woke: 1,
		});
	});

	test("a signal that matches no rule of the Wait does not wake it, one that matches ends it on that outcome", async () => {
		await setup([
			{
				id: "ci",
				inputs: {},
				enabled: true,
				webhook: { secret: HOOK_SECRET },
				signal: { name: "ci-done", key: "event.body.number" },
			},
		]);
		const run = await space.startRun({
			projectId,
			flowName: "ruled",
			inputs: { pr: "7" },
		});
		await waitFor(
			async () =>
				(await space.getRun(run.id)).status === "sleeping" ? true : null,
			{ label: "a sleeping run" },
		);

		const neutral = body({ number: 7, conclusion: "neutral" });
		expect(await send(neutral, signed(neutral), { scheduleId: "ci" })).toEqual({
			kind: "accepted",
		});
		expect((await logged())[0]?.payload).toMatchObject({ woke: 0 });
		expect((await space.getRun(run.id)).status).toBe("sleeping");

		const failed = body({ number: 7, conclusion: "failure" });
		expect(await send(failed, signed(failed), { scheduleId: "ci" })).toEqual({
			kind: "accepted",
		});
		const ended = await waitFor(
			async () => {
				const current = await space.getRun(run.id);
				return current.status === "finished" ? current : null;
			},
			{ label: "the woken run" },
		);
		expect(ended.steps[0]?.outcome).toBe("red");
	});
});
