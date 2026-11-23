import { describe, expect, test } from "bun:test";
import {
	byPerson,
	duePushes,
	heldTargetIds,
	heldTargets,
	LOST_AFTER_MS,
	pushedEntry,
	quietEnd,
	reachable,
	seenOnScreen,
	sendingClaim,
	wants,
	withdrawnEntry,
} from "./pushes";

const switches = {
	events: {
		gateOpened: true,
		runFinished: false,
		runFailed: true,
		deviceWait: false,
	},
};

describe("the rules of a push", () => {
	test("a Person wants what their switches say; a missed schedule is a failed run, Needs a look always", () => {
		expect(wants(switches, "gate-opened")).toBe(true);
		expect(wants(switches, "run-finished")).toBe(false);
		expect(wants(switches, "device-wait")).toBe(false);
		expect(wants(switches, "schedule-missed")).toBe(true);
		expect(wants(switches, "run-failed")).toBe(true);
		expect(
			wants(
				{ events: { ...switches.events, runFailed: false } },
				"flow-needs-a-look",
			),
		).toBe(true);
	});

	test("only this computer's desktop gets a push of a Space another daemon sends for", () => {
		const targets = [
			{ id: "w", kind: "web" as const },
			{ id: "d", kind: "desktop" as const },
		];
		expect(reachable(targets, false).map((t) => t.id)).toEqual(["d"]);
		expect(reachable(targets, true).map((t) => t.id)).toEqual(["w", "d"]);
		expect(heldTargets(targets, true).map((t) => t.id)).toEqual(["w"]);
		expect(heldTargets(targets, false)).toEqual([]);
	});

	test("a held push is due at its time, when its Person has no screen open, or a minute after a crash", () => {
		const held: {
			personId: string;
			dueAt: number | null;
			createdAt: number;
		}[] = [
			{ personId: "ada", dueAt: 10, createdAt: 0 },
			{ personId: "bob", dueAt: 99, createdAt: 0 },
			{ personId: "cy", dueAt: 99, createdAt: 0 },
		];
		const sending = [
			{ personId: "ada", dueAt: null, createdAt: 50 - LOST_AFTER_MS },
			{ personId: "ada", dueAt: null, createdAt: 49 },
		];
		const due = duePushes(held, sending, 50, (personId) => personId !== "cy");
		expect(due).toEqual([held[0], held[2], sending[0]] as typeof due);
	});

	test("an open screen showed a run's end, never a Gate, a missed schedule or Needs a look", () => {
		expect(seenOnScreen("run-finished", () => true)).toBe(true);
		expect(seenOnScreen("run-finished", () => false)).toBe(false);
		for (const kind of [
			"gate-opened",
			"schedule-missed",
			"flow-needs-a-look",
		] as const) {
			expect(seenOnScreen(kind, () => true)).toBe(false);
		}
	});

	test("the end of quiet hours sends the Gates and what still waits, and drops the runs that ended", () => {
		const rows = [
			{ key: "g", kind: "gate-opened" as const },
			{ key: "f", kind: "run-finished" as const },
			{ key: "w", kind: "device-wait" as const },
			{ key: "s", kind: "schedule-missed" as const },
			{ key: "x", kind: "run-failed" as const },
		];
		const { gates, stillWait, dropped } = quietEnd(rows);
		expect(gates.map((r) => r.key)).toEqual(["g"]);
		expect(stillWait.map((r) => r.key)).toEqual(["w", "s"]);
		expect(dropped.map((r) => r.key)).toEqual(["f", "x"]);
		expect(
			heldTargetIds([{ heldFor: ["a", "b"] }, { heldFor: ["b"] }]),
		).toEqual(["a", "b"]);
		expect([
			...byPerson([{ personId: "ada" }, { personId: "bob" }]).keys(),
		]).toEqual(["ada", "bob"]);
	});

	test("the entries of the log", () => {
		expect(sendingClaim(["a"], true, 100, 2)).toEqual({
			status: "sending",
			heldFor: ["a"],
			dueAt: 100 + 2 * 60_000,
		});
		expect(sendingClaim(["a"], false, 100, 2)).toEqual({
			status: "sending",
			heldFor: ["a"],
		});
		expect(pushedEntry(["a"], ["b"], 5)).toEqual({
			sentTo: ["a"],
			sentAt: 5,
			heldFor: ["b"],
			status: "held",
		});
		expect(pushedEntry([], [], 5).status).toBe("dropped");
		expect(withdrawnEntry({ sentTo: [] }, 5)).toEqual({
			status: "dropped",
			heldFor: [],
			withdrawnAt: 5,
		});
	});
});
