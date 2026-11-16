import { describe, expect, test } from "bun:test";
import type { PendingElsewhere } from "../contract";
import type { CommandsChange } from "./commands";
import { createPendingOnHosts } from "./pending-on-hosts";

/**
 * What a Device knows of the Commands that wait on its Hosts, with a
 * schedule the test runs by hand: no real wait.
 */

const answer = (id: string): PendingElsewhere => ({
	id,
	spaceId: "space-1",
	runId: "run-1",
	kind: "gate.resolve",
	createdAt: 1,
});

function known() {
	const scheduled: { ms: number; run: () => void; cancelled: boolean }[] = [];
	const pending = createPendingOnHosts({
		sentMs: 30_000,
		after(ms, run) {
			const entry = { ms, run, cancelled: false };
			scheduled.push(entry);
			return () => {
				entry.cancelled = true;
			};
		},
	});
	const changes: CommandsChange[] = [];
	pending.onChanged((change) => changes.push(change));
	return { pending, scheduled, changes };
}

describe("an action this Device sent", () => {
	test("goes by itself when the Host's sets came before it, and says so", async () => {
		const { pending, scheduled, changes } = known();
		// The Host's sets with the answer and without it both came first:
		// the Walker applied it fast. No set comes after it.
		pending.set("host-1", [answer("on-host")]);
		pending.set("host-1", []);
		changes.length = 0;
		pending.add("host-1", answer("sent-1"));
		expect(pending.of(["run-1"]).get("run-1")).toEqual([answer("sent-1")]);
		expect(changes).toEqual([{ spaceId: "space-1", runId: "run-1" }]);

		expect(scheduled.map((s) => s.ms)).toEqual([30_000]);
		scheduled[0]?.run();
		expect(pending.of(["run-1"]).size).toBe(0);
		expect(changes).toEqual([
			{ spaceId: "space-1", runId: "run-1" },
			{ spaceId: "space-1", runId: "run-1" },
		]);
	});

	test("goes with the Host's next set, and its own end then does nothing", async () => {
		const { pending, scheduled, changes } = known();
		pending.set("host-1", []);
		pending.add("host-1", answer("sent-1"));
		pending.set("host-1", [answer("on-host")]);
		expect(pending.of(["run-1"]).get("run-1")).toEqual([answer("on-host")]);
		expect(scheduled[0]?.cancelled).toBe(true);
		changes.length = 0;
		scheduled[0]?.run();
		expect(pending.of(["run-1"]).get("run-1")).toEqual([answer("on-host")]);
		expect(changes).toEqual([]);
	});

	test("counts only for a Host whose set this Device follows", async () => {
		const { pending, scheduled } = known();
		pending.add("host-1", answer("sent-1"));
		expect(pending.of(["run-1"]).size).toBe(0);
		expect(scheduled).toEqual([]);
	});
});
