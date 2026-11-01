import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { utc } from "@nightshift/time/testing";
import { createInAppChannel, type InAppItem } from "../channels";
import { createDeliveryLog, type DeliveryLog } from "../deliveries";
import type { DigestSource } from "../digest";
import { createSettingsStore, type SettingsStore } from "../settings";
import { createTargetStore, type TargetStore } from "../targets";
import { fakeRunEvents } from "../testing";
import { testDatabase } from "../testing/database";
import { type FakeChannel, fakeChannel } from "../testing/fakes";
import { createNotifier, type Notifier } from "./notifier";

/**
 * The morning digest, on a real database with a fake clock: once a day
 * per Person at the end of quiet hours or at their time, only the runs
 * that ended since the last digest, nothing when there is nothing to say,
 * once also after a restart, and one sender per Space.
 */

type EndedRun = Awaited<ReturnType<DigestSource["endedRuns"]>>[number];
type WaitingGate = Awaited<ReturnType<DigestSource["waitingGates"]>>[number];

const SPACE = "space-1";
const OTHER_SPACE = "space-2";
/** A time on 21 October 2026, UTC. */
const at = (hour: number, minute = 0, day = 21) =>
	utc(2026, 9, day, hour, minute);

let db: Database;
let cleanup: () => void;
let clock: number;
let web: FakeChannel;
let expo: FakeChannel;
let desktop: FakeChannel;
let settings: SettingsStore;
let targets: TargetStore;
let deliveries: DeliveryLog;
let members: Record<string, string[]>;
let senders: Set<string>;
let runs: EndedRun[];
let gates: WaitingGate[];
let notifier: Notifier;
let inAppItems: InAppItem[];
let stopScreen: AbortController;

const source: DigestSource = {
	endedRuns: async (spaceId, since) =>
		runs.filter((r) => r.spaceId === spaceId && r.endedAt > since),
	waitingGates: async (spaceId) => gates.filter((g) => g.spaceId === spaceId),
};

function makeNotifier(): Notifier {
	const inApp = createInAppChannel({ now: () => clock });
	inAppItems = [];
	stopScreen = new AbortController();
	void (async () => {
		for await (const item of inApp.watch("ada", stopScreen.signal)) {
			inAppItems.push(item);
		}
	})();
	return createNotifier({
		events: fakeRunEvents().source,
		audience: async (spaceId) => members[spaceId] ?? [],
		spaces: async () => Object.keys(members),
		sendsFor: async (spaceId) => senders.has(spaceId),
		settings,
		targets,
		deliveries,
		inApp,
		push: { web, expo, desktop },
		digests: source,
		now: () => clock,
		tickMs: 1_000_000,
		onError: (message, error) => {
			throw new Error(`${message} ${String(error)}`);
		},
	});
}

beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
	clock = at(6);
	web = fakeChannel();
	expo = fakeChannel();
	desktop = fakeChannel();
	settings = createSettingsStore(db, { timeZone: "UTC" });
	targets = createTargetStore(db, () => clock);
	deliveries = createDeliveryLog(db);
	members = { [SPACE]: ["ada"] };
	senders = new Set([SPACE, OTHER_SPACE]);
	runs = [];
	gates = [];
	notifier = makeNotifier();
	await settings.save("ada", {
		quietHours: { start: "22:00", end: "07:00" },
	});
});

afterEach(() => {
	notifier.stop();
	stopScreen.abort();
	cleanup();
});

function ended(
	id: string,
	endedAt: number,
	over: Partial<EndedRun> = {},
): EndedRun {
	return {
		id,
		spaceId: SPACE,
		title: `Triage · ${id}`,
		flowName: "Triage",
		status: "finished",
		result: null,
		reason: null,
		costUsd: 1.2,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		endedAt,
		...over,
	};
}

const register = (personId: string, kind: "web" | "expo" | "desktop") =>
	targets.register(personId, {
		kind,
		name: `${personId}'s ${kind}`,
		endpoint: `${kind}://${personId}`,
	});

async function tickAt(time: number): Promise<void> {
	clock = time;
	await notifier.tick();
}

describe("when the digest goes out", () => {
	test("once, when quiet hours end", async () => {
		const phone = await register("ada", "expo");
		runs.push(ended("run-1", at(3)));

		await tickAt(at(6, 59));
		expect(expo.sent()).toEqual([]);

		await tickAt(at(7));
		await tickAt(at(7, 5));
		await tickAt(at(12));

		expect(expo.calls).toEqual([
			{
				call: "send",
				targetId: phone.id,
				message: {
					key: "digest:2026-10-21",
					kind: "digest",
					spaceId: null,
					runId: null,
					stepId: null,
					title: "Night Shift: last night",
					body: "1 run finished. $1.20 spent.",
					alert: true,
					count: null,
					at: at(7),
				},
			},
		]);
		// The open pages get no item: they read the digest when they show it.
		expect(inAppItems).toEqual([]);
	});

	test("at 08:00 for a person without quiet hours", async () => {
		await settings.save("ada", { quietHours: null });
		await register("ada", "web");
		runs.push(ended("run-1", at(3)));

		await tickAt(at(7, 59));
		expect(web.sent()).toEqual([]);
		await tickAt(at(8));
		expect(web.sent()).toHaveLength(1);
	});

	test("at the time the person chose", async () => {
		await settings.save("ada", { digest: { when: "time", time: "09:30" } });
		await register("ada", "web");
		runs.push(ended("run-1", at(3)));

		await tickAt(at(7));
		expect(web.sent()).toEqual([]);
		await tickAt(at(9, 30));
		expect(web.sent()).toHaveLength(1);
	});

	test("never when the person turned it off", async () => {
		await settings.save("ada", { digest: { when: "off" } });
		await register("ada", "web");
		runs.push(ended("run-1", at(3)));

		await tickAt(at(7));
		await tickAt(at(13));

		expect(web.sent()).toEqual([]);
	});

	test("later that day when this computer was off at its time", async () => {
		await register("ada", "web");
		runs.push(ended("run-1", at(3)));

		await tickAt(at(10));

		expect(web.sent()).toHaveLength(1);
	});
});

describe("what the digest says", () => {
	test("only the runs that ended since the last digest", async () => {
		await register("ada", "web");
		runs.push(ended("run-1", at(3)));
		await tickAt(at(7));

		runs.push(
			ended("run-2", at(20), { status: "failed", costUsd: 0.5 }),
			ended("run-3", at(2, 0, 22), { costMissing: 1, costUsd: 0 }),
		);
		await tickAt(at(7, 0, 22));

		expect(web.sent().map((m) => [m.key, m.body])).toEqual([
			["digest:2026-10-21", "1 run finished. $1.20 spent."],
			["digest:2026-10-22", "1 run finished, 1 failed. At least $0.50 spent."],
		]);
	});

	test("the Gates that wait, also when no run ended", async () => {
		await register("ada", "web");
		gates.push({
			spaceId: SPACE,
			runId: "run-1",
			stepId: "step-1",
			runTitle: "Triage",
			flowName: "Triage",
		});

		await tickAt(at(7));

		expect(web.sent()[0]?.body).toBe("1 Gate waits for you.");
	});

	test("nothing when no run ended and no Gate waits", async () => {
		await register("ada", "web");

		await tickAt(at(7));
		// A run that ends later that day waits for the next digest.
		runs.push(ended("run-1", at(9)));
		await tickAt(at(10));

		expect(web.sent()).toEqual([]);
		const [row] = await deliveries.ofPerson("ada", "digest", 5);
		expect(row).toMatchObject({ key: "digest:2026-10-21", title: null });

		await tickAt(at(7, 0, 22));
		expect(web.sent().map((m) => m.body)).toEqual([
			"1 run finished. $1.20 spent.",
		]);
	});
});

describe("once a day", () => {
	test("a restart does not send the day's digest again", async () => {
		await register("ada", "web");
		runs.push(ended("run-1", at(3)));
		await tickAt(at(7));
		notifier.stop();

		notifier = makeNotifier();
		await tickAt(at(7, 1));
		await tickAt(at(9));

		expect(web.sent()).toHaveLength(1);
	});

	test("a digest a crash cut short goes out once after the restart", async () => {
		const phone = await register("ada", "web");
		await deliveries.claim(
			{
				personId: "ada",
				key: "digest:2026-10-21",
				kind: "digest",
				spaceId: "",
				runId: "",
				stepId: null,
				title: "Night Shift: last night",
				body: "1 run finished.",
			},
			{ status: "sending", heldFor: [phone.id] },
			at(7),
		);

		await tickAt(at(7, 2));
		await tickAt(at(7, 5));

		expect(web.sent().map((m) => [m.kind, m.key, m.body])).toEqual([
			["digest", "digest:2026-10-21", "1 run finished."],
		]);
	});
});

describe("one sender per Space", () => {
	test("phones hear of the Spaces this computer sends for, its desktop of every Space", async () => {
		members = { [SPACE]: ["ada"], [OTHER_SPACE]: ["ada"] };
		senders = new Set([SPACE]);
		await register("ada", "expo");
		await register("ada", "desktop");
		runs.push(
			ended("run-1", at(3)),
			ended("run-2", at(4), { spaceId: OTHER_SPACE, status: "failed" }),
		);

		await tickAt(at(7));

		expect(expo.sent().map((m) => m.body)).toEqual([
			"1 run finished. $1.20 spent.",
		]);
		expect(desktop.sent().map((m) => m.body)).toEqual([
			"1 run finished, 1 failed. $2.40 spent.",
		]);
	});

	test("a computer that sends for none of the person's Spaces pushes no phone", async () => {
		senders = new Set();
		await register("ada", "expo");
		runs.push(ended("run-1", at(3)));

		await tickAt(at(7));

		expect(expo.sent()).toEqual([]);
		// The inbox can still show it.
		const [row] = await deliveries.ofPerson("ada", "digest", 1);
		expect(row).toMatchObject({ status: "dropped", title: expect.any(String) });
	});
});
