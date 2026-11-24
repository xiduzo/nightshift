import { beforeEach, describe, expect, test } from "bun:test";
import { migratedDb } from "@nightshift/db/testing";
import type { Claim, Delivery } from "../../../../deliveries";
import type { DeliveryLog } from "../../application/ports";
import { drizzleDeliveryLog } from "./drizzle-delivery-log";

const AT = 1_700_000_000_000;

const gate = (personId: string, key = "run-1:step-1"): Claim => ({
	personId,
	key,
	kind: "gate-opened",
	spaceId: "space-1",
	runId: "run-1",
	stepId: "step-1",
});

/** The entries by Person and key, so the order of a read does not count. */
const sorted = (rows: Delivery[]) =>
	[...rows].sort((a, b) =>
		`${a.personId}:${a.key}`.localeCompare(`${b.personId}:${b.key}`),
	);

const make = async () => {
	const db = await migratedDb();
	return { deliveryLog: drizzleDeliveryLog(db) };
};

describe("DeliveryLog over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	let log: DeliveryLog;
	beforeEach(async () => {
		under = await make();
		log = under.deliveryLog;
	});

	test("a key is claimed once per Person, with what the claim said", async () => {
		expect(
			await log.claim(gate("ada"), { status: "sending", heldFor: ["t1"] }, AT),
		).toBe(true);
		expect(await log.claim(gate("ada"), { status: "sent" }, AT + 1)).toBe(
			false,
		);
		expect(await log.claim(gate("bob"), { status: "dropped" }, AT)).toBe(true);
		expect(await log.live("run-1:step-1")).toEqual([
			{
				...gate("ada"),
				title: null,
				body: null,
				status: "sending",
				dueAt: null,
				sentTo: [],
				heldFor: ["t1"],
				createdAt: AT,
				sentAt: null,
				withdrawnAt: null,
			},
		]);
	});

	test("the words of a claim are kept", async () => {
		await log.claim(
			{ ...gate("ada"), title: "Triage waits", body: "Until 18:00" },
			{ status: "held", dueAt: AT + 5, heldFor: ["t1"] },
			AT,
		);
		expect(await log.held()).toMatchObject([
			{ title: "Triage waits", body: "Until 18:00", dueAt: AT + 5 },
		]);
	});

	test("a withdrawn entry is claimed anew, with nothing of its last push", async () => {
		await log.claim(gate("ada"), { status: "sent", dueAt: AT + 9 }, AT);
		await log.update("ada", "run-1:step-1", {
			sentTo: ["t1"],
			sentAt: AT + 1,
		});
		await log.update("ada", "run-1:step-1", {
			status: "withdrawn",
			withdrawnAt: AT + 2,
		});
		expect(await log.live("run-1:step-1")).toEqual([]);
		expect(
			await log.claim(
				gate("ada"),
				{ status: "sending", heldFor: ["t2"] },
				AT + 3,
			),
		).toBe(true);
		expect(await log.sending()).toEqual([
			{
				...gate("ada"),
				title: null,
				body: null,
				status: "sending",
				dueAt: AT + 9,
				sentTo: [],
				heldFor: ["t2"],
				createdAt: AT + 3,
				sentAt: null,
				withdrawnAt: null,
			},
		]);
	});

	test("an update changes only what it names", async () => {
		await log.claim(gate("ada"), { status: "held", heldFor: ["t1"] }, AT);
		await log.update("ada", "run-1:step-1", {});
		await log.update("ada", "run-1:step-1", {
			status: "sent",
			sentTo: ["t1"],
		});
		await log.update("nobody", "run-1:step-1", { status: "dropped" });
		expect(await log.live("run-1:step-1")).toMatchObject([
			{ status: "sent", sentTo: ["t1"], heldFor: ["t1"], dueAt: null },
		]);
	});

	test("each read gives the entries of its status or kind", async () => {
		await log.claim(gate("ada", "g1"), { status: "held" }, AT);
		await log.claim(gate("bob", "g1"), { status: "quiet" }, AT);
		await log.claim(gate("cy", "g1"), { status: "dropped" }, AT);
		await log.claim(gate("ada", "g2"), { status: "sending" }, AT);
		await log.claim(
			{ ...gate("ada", "w1"), kind: "device-wait" },
			{ status: "sent" },
			AT,
		);
		const keys = (rows: Delivery[]) =>
			sorted(rows).map((row) => `${row.personId}:${row.key}`);
		expect(keys(await log.live("g1"))).toEqual(["ada:g1", "bob:g1"]);
		expect(keys(await log.liveOfKind("gate-opened"))).toEqual([
			"ada:g1",
			"ada:g2",
			"bob:g1",
		]);
		expect(keys(await log.liveOfKind("device-wait"))).toEqual(["ada:w1"]);
		expect(keys(await log.held())).toEqual(["ada:g1"]);
		expect(keys(await log.sending())).toEqual(["ada:g2"]);
		expect(keys(await log.quiet())).toEqual(["bob:g1"]);
	});

	test("a prune removes what is older, except a Gate or a wait that can still reach a screen", async () => {
		const run = (personId: string, key: string): Claim => ({
			...gate(personId, key),
			kind: "run-finished",
			stepId: null,
		});
		await log.claim(gate("ada", "old-gate"), { status: "sent" }, AT);
		await log.claim(gate("bob", "old-gate"), { status: "withdrawn" }, AT);
		await log.claim(
			{ ...gate("ada", "old-wait"), kind: "device-wait" },
			{ status: "held" },
			AT,
		);
		await log.claim(run("ada", "old-run"), { status: "sent" }, AT);
		await log.claim(run("ada", "new-run"), { status: "sent" }, AT + 10);
		expect(await log.prune(AT + 10)).toBe(2);
		expect(
			sorted([
				...(await log.liveOfKind("gate-opened")),
				...(await log.liveOfKind("device-wait")),
				...(await log.liveOfKind("run-finished")),
			]).map((row) => `${row.personId}:${row.key}`),
		).toEqual(["ada:new-run", "ada:old-gate", "ada:old-wait"]);
		expect(await log.prune(AT + 10)).toBe(0);
	});
});
