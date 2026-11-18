import { describe, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { FLOW_VERSION, type Flow, type Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemorySchedulePorts } from "../adapters/out/in-memory-neighbours";
import { createWebhookRefusals } from "../domain/webhook-delivery";
import { receiveWebhook } from "./receive-webhook";

/** A webhook for a schedule, on in-memory adapters: no HTTP server, no database. */

const P = "project-1";
const SECRET = "s3cret";
const NO_SECRET = "a-key-that-no-secret-is";
const NOW = 1_800_000_000_000;
// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

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

/** A signal-only webhook schedule: it starts no flow. */
function ciHook(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "ci",
		inputs: {},
		enabled: true,
		webhook: { secret: HOOK_SECRET },
		signal: { name: "ci-done", key: "event.body.number" },
		...extra,
	};
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

/** A project with `schedules` and the flow `echo`, and the secret `HOOK_SECRET`. */
function project(schedules: Schedule[]) {
	const ports = inMemorySchedulePorts(NOW);
	ports.projects.add({ id: P, spaceId: "space-1" });
	ports.store.seed(P, { flows: { echo: { json: echoFlow } }, schedules });
	ports.secrets.set("HOOK_SECRET", SECRET);
	const refusals = createWebhookRefusals();
	const receive = receiveWebhook({ ...ports, refusals, noSecret: NO_SECRET });
	return {
		ports,
		refusals,
		receive,
		/** Sends one webhook and waits for the work after its answer. */
		async send(
			payload: Uint8Array,
			headers: Headers,
			ids: { projectId?: string; scheduleId?: string } = {},
		) {
			const { answer, done } = await receive({
				projectId: ids.projectId ?? P,
				scheduleId: ids.scheduleId ?? "review",
				headers,
				body: payload,
			});
			await done;
			return answer;
		},
		/** The reasons of the refusals this engine remembers of a schedule, newest first. */
		refused: (scheduleId = "review") =>
			refusals.of(P, scheduleId).map((delivery) => delivery.reason),
	};
}

describe("a webhook for a schedule", () => {
	test("starts its flow with inputs read from the event, and logs that it took it", async () => {
		const { ports, send } = project([hook()]);
		const payload = body({ action: "opened", pull_request: { number: 7 } });
		expect(await send(payload, signed(payload))).toEqual({ kind: "accepted" });

		expect(ports.runs.started).toHaveLength(1);
		expect(ports.runs.started[0]).toMatchObject({
			input: {
				projectId: P,
				flowName: "echo",
				// A text input renders as text, a json input keeps its shape.
				inputs: {
					pr: "7",
					body: { action: "opened", pull_request: { number: 7 } },
				},
			},
			trigger: { kind: "webhook", scheduleId: "review", at: NOW },
		});
		expect(ports.log.facts.webhooks).toEqual([
			{
				projectId: P,
				scheduleId: "review",
				at: NOW,
				result: "accepted",
				runId: "run-1",
				woke: 0,
				error: null,
			},
		]);
	});

	test("refuses an unknown schedule and a wrong secret with one answer, and logs neither", async () => {
		const { ports, send, refused } = project([
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
		// A schedule without a webhook is no address.
		expect(
			await send(payload, signed(payload), { scheduleId: "cron" }),
		).toEqual(notFound);
		expect(await send(payload, signed(payload, {}, "guess"))).toEqual(notFound);
		expect(
			await send(payload, new Headers({ "content-type": "application/json" })),
		).toEqual(notFound);

		expect(ports.runs.started).toEqual([]);
		expect(ports.log.facts.webhooks).toEqual([]);
		// The person sees why the schedule's own webhooks did nothing.
		expect(refused()).toEqual([
			"The request had no secret.",
			"The secret did not match.",
		]);
		// Nothing is kept of an address that is none.
		expect(refused("missing")).toEqual([]);
		expect(refused("cron")).toEqual([]);
	});

	test("the key that stands in for the secret of an unknown schedule opens nothing", async () => {
		const { send } = project([hook()]);
		const payload = body({});
		expect(
			await send(payload, signed(payload, {}, NO_SECRET), {
				scheduleId: "missing",
			}),
		).toEqual({ kind: "not-found" });
		expect(await send(payload, signed(payload, {}, NO_SECRET))).toEqual({
			kind: "not-found",
		});
	});

	test("reads the secret for the schedule's project, by the name the schedule gives", async () => {
		const { ports, send } = project([hook()]);
		const payload = body({});
		await send(payload, signed(payload));
		expect(ports.secrets.asked).toEqual([
			{ name: "HOOK_SECRET", projectId: P },
		]);
	});

	test("a secret with no value refuses every webhook, and says so", async () => {
		const { send, refused } = project([
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
			hook({ webhook: { secret: "${OTHER}" } }),
			hook({ id: "plain", webhook: { secret: "not a reference" } }),
		]);
		const payload = body({});
		expect(await send(payload, signed(payload))).toEqual({
			kind: "not-found",
		});
		expect(refused()).toEqual([
			"The secret OTHER has no value here. Add it on the project's Secrets page.",
		]);
		expect(
			await send(payload, signed(payload), { scheduleId: "plain" }),
		).toEqual({ kind: "not-found" });
		expect(refused("plain")).toEqual([
			"The secret of this schedule has no value here. Add it on the project's Secrets page.",
		]);
	});

	test("takes a bearer secret, and filters by the schedule's rule", async () => {
		const { ports, send } = project([
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
		expect(ports.runs.started).toEqual([]);
		expect(ports.log.facts.webhooks).toEqual([
			{
				projectId: P,
				scheduleId: "review",
				at: NOW,
				result: "filtered",
				runId: null,
				woke: 0,
				error: null,
			},
		]);

		expect(await send(payload, bearer("pull_request"))).toEqual({
			kind: "accepted",
		});
		expect(ports.runs.started[0]?.input.inputs).toMatchObject({ pr: "8" });
	});

	test("a rule that fails filters the webhook, with the reason", async () => {
		const { ports, send } = project([
			hook({ webhook: { secret: HOOK_SECRET, when: "event.body.(" } }),
		]);
		const payload = body({});
		expect(await send(payload, signed(payload))).toEqual({ kind: "filtered" });
		expect(ports.log.facts.webhooks[0]).toMatchObject({
			result: "filtered",
			error: expect.stringMatching(/^The rule failed: /),
		});
	});

	test("a schedule that is off refuses, and so do schedules that are off and a Device that does not fire it", async () => {
		const payload = body({});
		const refusedWith = async (
			schedule: Schedule,
			change: (ports: ReturnType<typeof project>["ports"]) => void,
		) => {
			const { ports, send, refused } = project([schedule]);
			change(ports);
			const answer = await send(payload, signed(payload));
			expect(ports.runs.started).toEqual([]);
			// A refusal is told and remembered, and never logged.
			expect(ports.log.facts.webhooks).toEqual([]);
			expect(refused()).toEqual([
				answer.kind === "refused" ? answer.reason : answer.kind,
			]);
			return answer;
		};

		expect(await refusedWith(hook({ enabled: false }), () => {})).toEqual({
			kind: "refused",
			reason: "The schedule is paused.",
		});
		expect(
			await refusedWith(hook(), (ports) => ports.switch.turn(false)),
		).toEqual({ kind: "refused", reason: "Schedules are paused." });
		// An engine that never started its scheduler takes no webhook either.
		expect(
			await refusedWith(hook(), (ports) => ports.switch.start(false)),
		).toEqual({ kind: "refused", reason: "Schedules are paused." });
		expect(
			await refusedWith(hook(), (ports) =>
				ports.projects.add({ id: P, spaceId: "space-1", firesHere: false }),
			),
		).toEqual({
			kind: "refused",
			reason: "The Host of this Space takes this webhook. Send it there.",
		});
		// The schedule that is off counts first.
		expect(
			await refusedWith(hook({ enabled: false }), (ports) => {
				ports.switch.turn(false);
				ports.projects.add({ id: P, spaceId: "space-1", firesHere: false });
			}),
		).toEqual({ kind: "refused", reason: "The schedule is paused." });
	});

	test("its signal wakes the runs that wait for its key, with the event as data, and starts no run", async () => {
		const { ports, send } = project([ciHook()]);
		ports.runs.wakes(1);
		const payload = body({ number: 7, conclusion: "success" });
		expect(await send(payload, signed(payload), { scheduleId: "ci" })).toEqual({
			kind: "accepted",
		});
		expect(ports.runs.signals).toEqual([
			{
				projectId: P,
				signal: {
					name: "ci-done",
					key: "7",
					data: {
						body: { number: 7, conclusion: "success" },
						// The headers that carry a secret are left out.
						headers: {
							"content-type": "application/json",
							"x-github-event": "pull_request",
						},
					},
				},
			},
		]);
		expect(ports.runs.started).toEqual([]);
		expect(ports.log.facts.webhooks[0]).toMatchObject({
			result: "accepted",
			runId: null,
			woke: 1,
			error: null,
		});
	});

	test("hands the event to the pull request scores when the schedule says so", async () => {
		const scores: Schedule = {
			id: "ci",
			inputs: {},
			enabled: true,
			webhook: { secret: HOOK_SECRET },
			scorePullRequests: true,
		};
		const { ports, send } = project([
			scores,
			{ ...scores, id: "plain", scorePullRequests: false },
		]);
		const payload = body({ action: "closed" });
		await send(payload, signed(payload), { scheduleId: "ci" });
		await send(payload, signed(payload), { scheduleId: "plain" });
		expect(ports.scorer.taken).toHaveLength(1);
		expect(ports.scorer.taken[0]).toMatchObject({
			projectId: P,
			webhook: { body: { action: "closed" } },
		});
	});

	test("what goes wrong after the answer is logged in words, and the rest still happens", async () => {
		const { ports, send } = project([
			hook({ signal: { name: "ci-done" }, scorePullRequests: true }),
		]);
		ports.runs.failSignals(new Refusal("conflict", "No run waits here."));
		ports.scorer.fail(new Error("the database is gone"));
		ports.runs.failNextStart(
			new Refusal("conflict", "The run cap is reached."),
		);
		const payload = body({ pull_request: { number: 7 } });
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await send(payload, signed(payload))).toEqual({
				kind: "accepted",
			});
			// A refusal of the start is for the person. The other two go to the daemon's log.
			expect(logged.mock.calls.map((call) => call[0])).toEqual([
				"[webhooks] review could not send its signal",
				"[webhooks] review could not score pull requests",
			]);
		} finally {
			logged.mockRestore();
		}
		expect(ports.log.facts.webhooks).toEqual([
			{
				projectId: P,
				scheduleId: "review",
				at: NOW,
				result: "accepted",
				runId: null,
				woke: 0,
				error:
					"No run waits here. Something went wrong. Night Shift saved the details. Try again. The run cap is reached.",
			},
		]);
	});

	test("a signal key that fails sends no signal, and the run still starts", async () => {
		const { ports, send } = project([
			hook({ signal: { name: "ci-done", key: "event.body.(" } }),
		]);
		const payload = body({ pull_request: { number: 7 } });
		await send(payload, signed(payload));
		expect(ports.runs.signals).toEqual([]);
		expect(ports.runs.started).toHaveLength(1);
		expect(ports.log.facts.webhooks[0]).toMatchObject({
			runId: "run-1",
			error: expect.stringMatching(/^The signal's key failed: /),
		});
	});

	test("answers before the work is done: the run starts after the sender has its answer", async () => {
		const { ports, receive } = project([hook()]);
		let release: () => void = () => {};
		let reached: () => void = () => {};
		const atTheStart = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const start = ports.runs.start;
		ports.runs.start = async (input, trigger) => {
			reached();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return start(input, trigger);
		};
		const payload = body({ pull_request: { number: 7 } });
		const { answer, done } = await receive({
			projectId: P,
			scheduleId: "review",
			headers: signed(payload),
			body: payload,
		});
		expect(answer).toEqual({ kind: "accepted" });
		expect(ports.log.facts.webhooks).toEqual([]);

		// `done` ends after the log has the webhook.
		let ended = false;
		const finished = done.then(() => {
			ended = true;
		});
		await atTheStart;
		expect(ended).toBe(false);
		expect(ports.log.facts.webhooks).toEqual([]);
		release();
		await finished;
		expect(ports.log.facts.webhooks).toHaveLength(1);
	});

	test("the first of two schedules with one id counts", async () => {
		const { ports, send } = project([hook(), hook({ flow: "second" })]);
		const payload = body({ pull_request: { number: 7 } });
		await send(payload, signed(payload));
		expect(ports.runs.started.map((start) => start.input)).toMatchObject([
			{ flowName: "echo" },
		]);
	});

	test("a flow whose inputs do not load still starts, with the values as text", async () => {
		const { ports, send } = project([hook({ flow: "gone" })]);
		const payload = body({ pull_request: { number: 7 } });
		expect(await send(payload, signed(payload))).toEqual({ kind: "accepted" });
		expect(ports.runs.started[0]?.input).toMatchObject({ flowName: "gone" });
	});
});
