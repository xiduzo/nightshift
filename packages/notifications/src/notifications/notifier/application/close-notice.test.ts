import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import { notifier } from "../test-support";

/** The use case closeNotice, over a database in memory: answer once, clear everywhere. */

const SPACE = "space-1";
/** 12:00 UTC on a weekday. */
const NOON = utc(2026, 9, 21, 12, 0);

async function setup() {
	const n = await notifier();
	n.ports.time = NOON;
	return n;
}

describe("closeNotice", () => {
	test("the open pages of the Space first, then each push that went out, then the entry is withdrawn", async () => {
		const n = await setup();
		const order: string[] = [];
		const web = n.ports.targets.add("ada", "web");
		await n.openGate("run-1", "step-1");
		const inAppWithdraw = n.ports.inApp.withdraw;
		n.ports.inApp.withdraw = async (target, key) => {
			order.push(`in-app ${target.personId}`);
			await inAppWithdraw(target, key);
		};
		const pushWithdraw = n.ports.pushes.web.withdraw;
		n.ports.pushes.web.withdraw = async (target, key) => {
			order.push(`push ${target.id}`);
			await pushWithdraw(target, key);
		};

		n.ports.time += 60_000;
		await n.close({ spaceId: SPACE, key: "run-1:step-1" });

		expect(order).toEqual(["in-app ada", "in-app bob", `push ${web.id}`]);
		expect(await n.ports.deliveries.entry("ada", "run-1:step-1")).toMatchObject(
			{
				status: "withdrawn",
				heldFor: [],
				withdrawnAt: NOON + 60_000,
			},
		);
	});

	test("a push that still waits, and went nowhere yet, is dropped", async () => {
		const n = await setup();
		n.ports.targets.add("ada", "expo");
		n.ports.inApp.setActive("ada", true);
		await n.openGate("run-1", "step-1");

		await n.close({ spaceId: SPACE, key: "run-1:step-1" });

		expect(n.ports.pushes.expo.calls).toEqual([]);
		expect(await n.ports.deliveries.entry("ada", "run-1:step-1")).toMatchObject(
			{
				status: "dropped",
				heldFor: [],
			},
		);
	});

	test("a key nobody got withdraws only on the open pages", async () => {
		const n = await setup();

		await n.close({ spaceId: SPACE, key: "run-9:step-9" });

		expect(n.ports.inApp.of("ada")).toEqual([
			{ call: "withdraw", key: "run-9:step-9" },
		]);
		expect(n.ports.inApp.of("cy")).toEqual([]);
	});
});
