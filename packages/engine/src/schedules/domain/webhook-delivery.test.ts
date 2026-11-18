import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import {
	createWebhookRefusals,
	DELIVERIES_SHOWN,
	deliveryOf,
	latestDeliveries,
	WEBHOOK_ERROR_WORDS,
	WEBHOOK_SECRET_WORDS,
	type WebhookDelivery,
	webhookRefusal,
	webhookScheduleOf,
} from "./webhook-delivery";

// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

function hook(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "review",
		flow: "echo",
		inputs: {},
		webhook: { secret: HOOK_SECRET },
		enabled: true,
		...extra,
	};
}

const P = "project-1";

describe("the schedule a webhook names", () => {
	test("is the first with that id, when a webhook starts it", () => {
		const cron: Schedule = {
			id: "cron",
			flow: "echo",
			inputs: {},
			cron: "0 3 * * *",
			enabled: true,
		};
		const schedules = [hook(), hook({ flow: "second" }), cron];
		expect(webhookScheduleOf(schedules, "review")).toBe(schedules[0] ?? null);
		expect(webhookScheduleOf(schedules, "cron")).toBeNull();
		expect(webhookScheduleOf(schedules, "missing")).toBeNull();
	});
});

describe("why a schedule does not take a webhook", () => {
	const yes = async () => true;
	const no = async () => false;

	test("it takes it when it is on, schedules are on and this Device fires it", async () => {
		expect(await webhookRefusal(hook(), () => true, yes)).toBeNull();
	});

	test("a schedule that is off comes first, then the switch, then the Device", async () => {
		expect(
			await webhookRefusal(hook({ enabled: false }), () => false, no),
		).toBe("The schedule is paused.");
		expect(await webhookRefusal(hook(), () => false, no)).toBe(
			"Schedules are paused.",
		);
		expect(await webhookRefusal(hook(), () => true, no)).toBe(
			"The Host of this Space takes this webhook. Send it there.",
		);
	});

	test("asks the switch and the Device only when it must", async () => {
		const asked: string[] = [];
		const on = () => {
			asked.push("switch");
			return false;
		};
		const fires = async () => {
			asked.push("device");
			return true;
		};
		await webhookRefusal(hook({ enabled: false }), on, fires);
		expect(asked).toEqual([]);
		await webhookRefusal(hook(), on, fires);
		expect(asked).toEqual(["switch"]);
	});

	test("the words for a secret that did not check out, and for a rule or key that failed", () => {
		expect(WEBHOOK_SECRET_WORDS.noValue("OTHER")).toBe(
			"The secret OTHER has no value here. Add it on the project's Secrets page.",
		);
		expect(WEBHOOK_SECRET_WORDS.noValue(null)).toBe(
			"The secret of this schedule has no value here. Add it on the project's Secrets page.",
		);
		expect(WEBHOOK_SECRET_WORDS.wrong).toBe("The secret did not match.");
		expect(WEBHOOK_SECRET_WORDS.none).toBe("The request had no secret.");
		expect(WEBHOOK_ERROR_WORDS.rule("boom")).toBe("The rule failed: boom");
		expect(WEBHOOK_ERROR_WORDS.signalKey("boom")).toBe(
			"The signal's key failed: boom",
		);
	});
});

describe("the refusals of a schedule", () => {
	test("are kept newest first, as deliveries that started nothing", () => {
		const refusals = createWebhookRefusals();
		refusals.add(P, "review", 100, "The request had no secret.");
		refusals.add(P, "review", 200, "The secret did not match.");
		expect(refusals.of(P, "review")).toEqual([
			{
				at: 200,
				result: "refused",
				reason: "The secret did not match.",
				runId: null,
				woke: 0,
			},
			{
				at: 100,
				result: "refused",
				reason: "The request had no secret.",
				runId: null,
				woke: 0,
			},
		]);
		expect(refusals.of(P, "other")).toEqual([]);
		expect(refusals.of("project-2", "review")).toEqual([]);
	});

	test("keep only as many as the Schedules page shows", () => {
		const refusals = createWebhookRefusals();
		for (let at = 1; at <= DELIVERIES_SHOWN + 5; at++) {
			refusals.add(P, "review", at, "The request had no secret.");
		}
		const kept = refusals.of(P, "review");
		expect(kept).toHaveLength(DELIVERIES_SHOWN);
		expect(kept[0]?.at).toBe(DELIVERIES_SHOWN + 5);
		expect(kept.at(-1)?.at).toBe(6);
	});
});

describe("the latest deliveries of a schedule", () => {
	test("a logged webhook reads as a delivery, its error as the reason", () => {
		expect(
			deliveryOf({
				projectId: P,
				scheduleId: "review",
				at: 100,
				result: "accepted",
				runId: "run-1",
				woke: 2,
				error: null,
			}),
		).toEqual({
			at: 100,
			result: "accepted",
			reason: null,
			runId: "run-1",
			woke: 2,
		});
	});

	test("are the logged ones and the refusals together, newest first, at most ten", () => {
		const delivery = (
			at: number,
			result: WebhookDelivery["result"],
		): WebhookDelivery => ({ at, result, reason: null, runId: null, woke: 0 });
		expect(
			latestDeliveries(
				[delivery(300, "accepted"), delivery(100, "filtered")],
				[delivery(200, "refused")],
			).map((d) => d.result),
		).toEqual(["accepted", "refused", "filtered"]);

		const many = Array.from({ length: DELIVERIES_SHOWN }, (_, index) =>
			delivery(index, "accepted"),
		);
		const latest = latestDeliveries(many, [delivery(1000, "refused")]);
		expect(latest).toHaveLength(DELIVERIES_SHOWN);
		expect(latest[0]?.result).toBe("refused");
		expect(DELIVERIES_SHOWN).toBe(10);
	});
});
