import { describe, expect, test } from "bun:test";

import type { OpenGate } from "../gates";
import type { RunStatus, RunSummary } from "../runs";
import {
	compareGates,
	compareRuns,
	describeNotice,
	gateKey,
	isWanted,
	type Notice,
} from "./rules";

const gate = (runId: string, stepId: string) =>
	({
		runId,
		stepId,
		projectName: "app",
		runTitle: "Fix the login",
		question: "Ship it?",
	}) as unknown as OpenGate;

const run = (id: string, status: RunStatus, reason?: string) =>
	({ id, status, title: `Run ${id}`, reason }) as unknown as RunSummary;

const kinds = (notices: Notice[]) =>
	notices.map((notice) =>
		notice.kind === "gate-opened"
			? `${notice.kind} ${notice.key}`
			: `${notice.kind} ${notice.run.id}`,
	);

describe("a new Gate", () => {
	test("is one Gate per run and step", () => {
		expect(gateKey(gate("r1", "review"))).toBe("r1:review");
	});

	test("the first load is the baseline: no notice", () => {
		const { seen, notices } = compareGates(null, [gate("r1", "review")]);
		expect(notices).toEqual([]);
		expect([...seen]).toEqual(["r1:review"]);
	});

	test("only a Gate that was not open before", () => {
		const before = new Set(["r1:review"]);
		const { seen, notices } = compareGates(before, [
			gate("r1", "review"),
			gate("r1", "deploy"),
			gate("r2", "review"),
		]);
		expect(kinds(notices)).toEqual([
			"gate-opened r1:deploy",
			"gate-opened r2:review",
		]);
		expect(seen.size).toBe(3);
	});

	test("a Gate that closed and opens again is new again", () => {
		const first = compareGates(new Set(["r1:review"]), []);
		const second = compareGates(first.seen, [gate("r1", "review")]);
		expect(kinds(second.notices)).toEqual(["gate-opened r1:review"]);
	});
});

describe("a run that ended", () => {
	test("the first load is the baseline: no notice", () => {
		const { seen, notices } = compareRuns(null, [run("r1", "failed")]);
		expect(notices).toEqual([]);
		expect(seen.get("r1")).toBe("failed");
	});

	test("finished or failed since the last poll", () => {
		const before = new Map<string, RunStatus>([
			["r1", "running"],
			["r2", "running"],
			["r3", "running"],
			["r4", "finished"],
		]);
		const { notices } = compareRuns(before, [
			run("r1", "finished"),
			run("r2", "failed"),
			run("r3", "waiting"),
			run("r4", "finished"),
		]);
		expect(kinds(notices)).toEqual(["run-finished r1", "run-failed r2"]);
	});

	test("a run that is new and already ended counts", () => {
		const { notices } = compareRuns(new Map(), [run("r9", "failed")]);
		expect(kinds(notices)).toEqual(["run-failed r9"]);
	});
});

describe("what the person wants to know", () => {
	const opened: Notice = {
		kind: "gate-opened",
		key: "r1:review",
		gate: gate("r1", "review"),
	};
	const finished: Notice = { kind: "run-finished", run: run("r1", "finished") };
	const failed: Notice = { kind: "run-failed", run: run("r1", "failed") };

	test("each kind has its own choice", () => {
		const choices = { notifyGateOpened: true, notifyRunFailed: true };
		expect(isWanted(opened, choices)).toBe(true);
		expect(isWanted(finished, choices)).toBe(false);
		expect(isWanted(failed, choices)).toBe(true);
	});

	test("nothing while the settings are not loaded", () => {
		expect(isWanted(opened, undefined)).toBe(false);
		expect(isWanted(failed, null)).toBe(false);
	});
});

describe("the words of a notice", () => {
	test("a Gate names its project, its run and its question", () => {
		expect(
			describeNotice({
				kind: "gate-opened",
				key: "r1:review",
				gate: gate("r1", "review"),
			}),
		).toEqual({
			title: "app: a Gate waits for you",
			body: "Fix the login\nShip it?",
			tag: "gate:r1:review",
		});
	});

	test("a run names its title, and why it ended when it knows", () => {
		expect(
			describeNotice({
				kind: "run-finished",
				run: run("r1", "finished", "ship"),
			}),
		).toEqual({
			title: "A run finished",
			body: "Run r1\nEnded on ship",
			tag: "run:r1:finished",
		});
		expect(
			describeNotice({ kind: "run-failed", run: run("r2", "failed") }),
		).toEqual({ title: "A run failed", body: "Run r2", tag: "run:r2:failed" });
	});
});
