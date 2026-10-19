import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { project, run } from "@nightshift/db/schema/nightshift";
import type { Flow } from "@nightshift/flows";

import type { EnginePayloads, LoggedEvent } from "./events";
import { daemonResumeBlock, type ResumeBlockDeps } from "./recovery";
import { defaultRunSettings, type RunSettings } from "./settings";
import { createSandbox, type Sandbox } from "./test-support";

/**
 * `daemonResumeBlock`: why a daemon leaves an interrupted run to a person.
 * Recovery as a whole (the interrupted facts, the grace timer, the queue on
 * a full run cap) is covered by engine.test.ts through the public interface.
 */

let sandbox: Sandbox;

beforeEach(async () => {
	sandbox = await createSandbox();
});

afterEach(async () => {
	await sandbox.cleanup();
});

const RUN_ID = "run-1";
const flow: Flow = {
	version: 2,
	start: "a",
	nodes: [{ id: "a", type: "agent", prompt: "work" }],
	edges: [],
} as unknown as Flow;

/** One run's log, in seq order. */
function logOf(
	...items: { type: keyof EnginePayloads; payload: unknown }[]
): LoggedEvent[] {
	return items.map(
		(item, i) =>
			({
				seq: i + 1,
				runId: RUN_ID,
				stepId: null,
				sessionId: null,
				type: item.type,
				payload: item.payload,
				at: 1000 + i,
			}) as LoggedEvent,
	);
}

const started = (stopAt: number | null = null) => ({
	type: "RunStarted" as const,
	payload: { projectId: "p", flowName: "f", title: "f", start: "a", stopAt },
});
const daemonResumed = {
	type: "RunResumed" as const,
	payload: { nodeId: "a", stepId: null, prompt: null, by: "daemon" },
};
const personResumed = {
	type: "RunResumed" as const,
	payload: { nodeId: "a", stepId: null, prompt: null, by: "person" },
};

/** A run row whose worktree is `worktreePath` and whose flow is `ownFlow`. */
async function insertRun(worktreePath: string, ownFlow: Flow = flow) {
	await sandbox.db
		.insert(project)
		.values({ id: "p", name: "p", repoPath: sandbox.repoPath })
		.onConflictDoNothing();
	await sandbox.db.insert(run).values({
		id: RUN_ID,
		projectId: "p",
		flowName: "f",
		flow: JSON.stringify(ownFlow),
		bodyFlows: "{}",
		title: "f",
		worktreePath,
		branch: "b",
		baseRef: "main",
	});
}

function deps(overrides: Partial<ResumeBlockDeps> = {}): ResumeBlockDeps {
	return {
		db: sandbox.db,
		now: () => 10_000,
		settings: () => defaultRunSettings(),
		schedulerOn: true,
		flowOf: (row) => JSON.parse(row.flow) as Flow,
		...overrides,
	};
}

describe("daemonResumeBlock", () => {
	test("lets a run continue when nothing stands in the way", async () => {
		await insertRun(sandbox.repoPath);
		expect(
			await daemonResumeBlock(RUN_ID, logOf(started()), deps()),
		).toBeNull();
	});

	test("a daemon without the scheduler never continues the night's runs", async () => {
		await insertRun(sandbox.repoPath);
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({ schedulerOn: false }),
			),
		).toBe("schedules are paused.");
		const paused: RunSettings = { ...defaultRunSettings(), scheduler: false };
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({ settings: () => paused }),
			),
		).toBe("schedules are paused.");
	});

	test("a missing run record", async () => {
		expect(await daemonResumeBlock(RUN_ID, logOf(started()), deps())).toBe(
			"the run's record is missing.",
		);
	});

	test("the flow's own policy wins over the Settings switch", async () => {
		await insertRun(sandbox.repoPath, {
			...flow,
			policy: { resumeInterruptedRuns: false },
		});
		expect(await daemonResumeBlock(RUN_ID, logOf(started()), deps())).toBe(
			"its flow turns automatic resume off.",
		);
	});

	test("automatic resume off in Settings", async () => {
		await insertRun(sandbox.repoPath);
		const off: RunSettings = {
			...defaultRunSettings(),
			resumeInterruptedRuns: false,
		};
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({ settings: () => off }),
			),
		).toBe("automatic resume is off in Settings.");
	});

	test("three daemon resumes in a row, with no person in between", async () => {
		await insertRun(sandbox.repoPath);
		const events = logOf(
			started(),
			daemonResumed,
			daemonResumed,
			daemonResumed,
		);
		expect(await daemonResumeBlock(RUN_ID, events, deps())).toBe(
			"it continued on its own 3 times in a row, and each time Night Shift stopped again.",
		);
		// A person's resume starts the count over.
		const withPerson = logOf(
			started(),
			daemonResumed,
			daemonResumed,
			personResumed,
			daemonResumed,
		);
		expect(await daemonResumeBlock(RUN_ID, withPerson, deps())).toBeNull();
	});

	test("a stop time that has passed", async () => {
		await insertRun(sandbox.repoPath);
		expect(await daemonResumeBlock(RUN_ID, logOf(started(9_000)), deps())).toBe(
			"its stop time has passed.",
		);
		expect(
			await daemonResumeBlock(RUN_ID, logOf(started(11_000)), deps()),
		).toBeNull();
	});

	test("a worktree that is gone", async () => {
		await insertRun(join(sandbox.root, "gone"));
		expect(await daemonResumeBlock(RUN_ID, logOf(started()), deps())).toBe(
			"the copy of the project it worked in is gone.",
		);
	});

	test("a check that throws is a reason, not a crash", async () => {
		await insertRun(sandbox.repoPath);
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({
					flowOf: () => {
						throw new Error("bad snapshot");
					},
				}),
			),
		).toBe("Night Shift could not check it: bad snapshot");
	});
});
