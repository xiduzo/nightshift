import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { fakeHarness } from "@nightshift/agents/testing";
import { event } from "@nightshift/db/schema";
import type { Flow, Schedule } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { parseEventRow } from "../log/events";
import { createEngine, type Engine } from "../run/engine";
import type { SpaceEngine } from "../run/space-engine";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { webhookAuthentic } from "./webhooks";

/** Webhook schedules: a signed request starts a run, sends a signal, or is refused. */

const SECRET = "s3cret";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

let sandbox: Sandbox;
let controller: AbortController;
let engine: Engine;
let space: SpaceEngine;
let projectId: string;

beforeEach(async () => {
	sandbox = await createSandbox();
	controller = new AbortController();
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			secret: async (name) => (name === "HOOK_SECRET" ? SECRET : undefined),
		}),
		{ signal: controller.signal },
	);
	space = engine.space(sandbox.spaceId);
	projectId = (await space.addProject({ repoPath: sandbox.repoPath })).id;
});
afterEach(async () => {
	controller.abort();
	await sandbox.cleanup();
});

const echoFlow: Flow = {
	version: 7,
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
			output: "text",
		},
	],
	edges: [],
};

/** Waits for the signal `ci-done` with the run's own `pr` as the key. */
const waitFlow: Flow = {
	version: 7,
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
		{ echo: echoFlow, wait: waitFlow },
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

describe("webhookAuthentic", () => {
	const payload = body({ a: 1 });

	test("takes GitHub's signature or a bearer secret, and nothing else", () => {
		expect(webhookAuthentic(signed(payload), payload, SECRET)).toBe(true);
		expect(webhookAuthentic(signed(payload), body({ a: 2 }), SECRET)).toBe(
			false,
		);
		expect(
			webhookAuthentic(signed(payload, {}, "other"), payload, SECRET),
		).toBe(false);
		const bearer = (value: string) =>
			webhookAuthentic(new Headers({ authorization: value }), payload, SECRET);
		expect(bearer(`Bearer ${SECRET}`)).toBe(true);
		expect(bearer(`bearer ${SECRET}`)).toBe(true);
		expect(bearer("Bearer s3cre")).toBe(false);
		expect(bearer(SECRET)).toBe(false);
		expect(webhookAuthentic(new Headers(), payload, SECRET)).toBe(false);
	});

	test("takes the signature of the curl example in docs/deploy/triggers.md", () => {
		// `printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET"` gives this hex.
		const sent = new TextEncoder().encode(
			'{"event":"workflow_dispatch","ref":"main"}',
		);
		const headers = new Headers({
			"x-hub-signature-256":
				"sha256=c98cccfa6a826fa62986e44f9d6f1415f5cda15491c5e96a1f29f8bd1e9fcba5",
		});
		expect(webhookAuthentic(headers, sent, SECRET)).toBe(true);
	});
});

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

	test("refuses an unknown schedule and a wrong secret with one answer, and logs neither", async () => {
		await setup([
			hook(),
			{
				id: "cron",
				flow: "echo",
				inputs: {},
				cron: "0 3 * * *",
				enabled: false,
			},
		]);
		const payload = body({ pull_request: { number: 7 } });
		const notFound = { kind: "not-found" } as const;
		expect(await send(payload, signed(payload), { projectId: "nope" })).toEqual(
			notFound,
		);
		expect(
			await send(payload, signed(payload), { scheduleId: "missing" }),
		).toEqual(notFound);
		expect(
			await send(payload, signed(payload), { scheduleId: "cron" }),
		).toEqual(notFound);
		expect(await send(payload, signed(payload, {}, "guess"))).toEqual(notFound);
		expect(
			await send(payload, new Headers({ "content-type": "application/json" })),
		).toEqual(notFound);

		expect(await space.listRuns()).toEqual([]);
		expect(await logged()).toEqual([]);
		// The person sees why the schedule's own webhooks did nothing.
		const list = await space.listSchedules(projectId);
		expect(
			list.schedules[0]?.deliveries.map((d) => [d.result, d.reason]),
		).toEqual([
			["refused", "The request had no secret."],
			["refused", "The secret did not match."],
		]);
	});

	test("a secret with no value refuses every webhook, and says so", async () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
		await setup([hook({ webhook: { secret: "${OTHER}" } })]);
		const payload = body({});
		expect(await send(payload, signed(payload))).toEqual({
			kind: "not-found",
		});
		const list = await space.listSchedules(projectId);
		expect(list.schedules[0]?.deliveries[0]?.reason).toBe(
			"The secret OTHER has no value on this computer. Add it on the Secrets page.",
		);
	});

	test("takes a bearer secret, filters by its rule, and a paused one refuses", async () => {
		await setup([
			hook({
				webhook: {
					secret: HOOK_SECRET,
					when: 'event.headers.`x-github-event` = "pull_request"',
				},
			}),
		]);
		const payload = body({ pull_request: { number: 8 } });
		const bearer = (event: string) =>
			new Headers({
				authorization: `Bearer ${SECRET}`,
				"content-type": "application/json",
				"x-github-event": event,
			});

		expect(await send(payload, bearer("push"))).toEqual({ kind: "filtered" });
		expect(await space.listRuns()).toEqual([]);
		expect(await send(payload, bearer("pull_request"))).toEqual({
			kind: "accepted",
		});
		expect((await space.listRuns())[0]?.inputs).toMatchObject({ pr: "8" });

		await seedFlows(space, projectId, {}, [hook({ enabled: false })]);
		expect(await send(payload, bearer("pull_request"))).toEqual({
			kind: "refused",
			reason: "The schedule is paused.",
		});
		const list = await space.listSchedules(projectId);
		expect(list.schedules[0]?.deliveries.map((d) => d.result)).toEqual([
			"refused",
			"accepted",
			"filtered",
		]);
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
});
