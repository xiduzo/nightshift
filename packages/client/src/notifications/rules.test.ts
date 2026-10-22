import { describe, expect, test } from "bun:test";

import type { OpenGate } from "../gates";
import type { RunStatus, RunSummary } from "../runs";
import { describeNotice } from "./rules";

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

describe("the words of a notice", () => {
	test("a Gate names its project, its run and its question", () => {
		expect(
			describeNotice({
				kind: "gate-opened",
				gate: gate("r1", "review"),
			}),
		).toEqual({
			title: "app: a Gate waits for you",
			body: "Fix the login\nShip it?",
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
		});
		expect(
			describeNotice({ kind: "run-failed", run: run("r2", "failed") }),
		).toEqual({ title: "A run failed", body: "Run r2" });
	});
});
