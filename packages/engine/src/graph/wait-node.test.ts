import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import type { WaitNode } from "@nightshift/flows";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSleep } from "../read/derive-run";
import { deriveSteps } from "../read/derive-steps";
import {
	command,
	drive,
	flowOf,
	MINUTE,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { parseTime } from "./nodes/wait";

/**
 * The Wait node on the compiled graph, with a real shell, run log and
 * checkpoint saver. The clock is the harness's `ctx.now`, moved by hand as the
 * other wait tests do; a wake is what the runner sends: `WaitEnded` in the
 * log, then `Command({ resume: { kind: "wake" } })`, on a new compile over
 * the same saver (a new daemon).
 */

const wait = (
	id: string,
	until: WaitNode["until"],
	extra: Partial<WaitNode> = {},
): WaitNode => ({
	id,
	type: "wait",
	position: { x: 0, y: 0 },
	until,
	...extra,
});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** A clock the test moves. */
function clock(start = Date.now()) {
	let now = start;
	return {
		now: () => now,
		advance: (minutes: number) => {
			now += minutes * MINUTE;
		},
	};
}

describe("the Wait node", () => {
	test("a time: a clock time means the next one, a date and time is taken as is, and a past time wakes at once", async () => {
		const start = new Date(2026, 9, 17, 22, 0, 0, 0).getTime();
		const time = clock(start);
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "when" }],
				start: "at",
				nodes: [wait("at", { kind: "time", at: "{{when}}" })],
				edges: [],
			}),
			{ inputs: { when: "07:00" } },
		);
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: { when: "07:00" } });
		const seven = new Date(2026, 9, 18, 7, 0, 0, 0).getTime();
		expect(first.parked[0]).toMatchObject({
			kind: "wait",
			reason: "time",
			until: seven,
		});

		expect(parseTime("2026-10-18T07:00", start)).toBe(
			new Date(2026, 9, 18, 7, 0).getTime(),
		);
		expect(parseTime("2026-10-18T07:00:00Z", start)).toBe(
			Date.parse("2026-10-18T07:00:00Z"),
		);
		expect(parseTime("22:00", start)).toBe(
			new Date(2026, 9, 18, 22, 0).getTime(),
		);
		expect(parseTime("soon", start)).toBeNull();
		expect(parseTime("", start)).toBeNull();
		expect(parseTime("25:00", start)).toBeNull();

		// A time in the past: the wake time is that time, and the runner's timer fires at once.
		const past = await startRun(
			sandbox,
			flowOf({
				start: "at",
				nodes: [wait("at", { kind: "time", at: "2026-10-17T20:00" })],
				edges: [],
			}),
		);
		past.ctx.now = time.now;
		const parked = await drive(past, { inputs: {} });
		expect(parked.parked[0]).toMatchObject({
			kind: "wait",
			until: new Date(2026, 9, 17, 20, 0).getTime(),
		});
		await drive(
			past,
			new Command({ resume: { kind: "wake", early: false } }),
			past.graph(),
		);
		expect(deriveSteps(await past.events())[0]?.outcome).toBe("done");
	});

	test("a time that does not parse fails the step with a plain message", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "when" }],
				start: "at",
				nodes: [wait("at", { kind: "time", at: "{{when}}" })],
				edges: [],
			}),
			{ inputs: { when: "after lunch" } },
		);
		const { parked, state } = await drive(h, {
			inputs: { when: "after lunch" },
		});
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: deriveSteps(await h.events())[0]?.id as string,
				nodeId: "at",
				status: "failed",
				reason:
					'Node "at" failed: The time "after lunch" is not valid. Write a date and time like 2026-10-18T07:00, or a time like 07:00.',
			},
		]);
		expect(state.nodes.at).toEqual({
			outcome: "error",
			waited_minutes: 0,
			visit: 1,
		});
		expect(await h.types()).toEqual(["RunStarted", "StepStarted", "StepEnded"]);
	});

	test("a command: runs at once, sleeps the interval while it fails, and ends done with the log tail when it passes", async () => {
		const time = clock();
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "flag" }],
				start: "ci",
				nodes: [
					wait("ci", {
						kind: "command",
						command: 'echo "checking {{flag}}"; test -f "{{flag}}"',
						everyMinutes: 5,
					}),
				],
				edges: [],
			}),
			{ inputs: { flag: "green" } },
		);
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: { flag: "green" } });
		const [stepRow] = deriveSteps(await h.events());
		const stepId = stepRow?.id as string;
		expect(first.parked[0]).toEqual({
			kind: "wait",
			stepId,
			nodeId: "ci",
			reason: "command",
			until: time.now() + 5 * MINUTE,
			message: "The command did not pass yet. Tries again in 5 min.",
		});
		expect(payloads(await h.events(), "StepStarted")[0]?.logPath).toBe(
			join(sandbox.dataDir, "logs", h.runId, `${stepId}.log`),
		);

		// Still red on the second try.
		time.advance(5);
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.parked[0]).toMatchObject({
			kind: "wait",
			stepId,
			until: time.now() + 5 * MINUTE,
		});
		expect(second.state.pending).toMatchObject({
			streak: { count: 2, since: time.now() - 5 * MINUTE },
		});

		// Green on the third.
		await Bun.write(join(sandbox.repoPath, "green"), "");
		time.advance(5);
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});
		const third = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(third.parked).toEqual([]);
		expect(third.state.ended?.status).toBe("finished");
		expect(third.state.nodes.ci).toEqual({
			outcome: "done",
			waited_minutes: 10,
			log_tail: "checking green",
			visit: 1,
		});
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"WaitStarted",
			"WaitEnded",
			"WaitStarted",
			"WaitEnded",
			"StepEnded",
		]);
		const transcript = await readTranscriptFile(
			stepRow?.transcriptPath as string,
		);
		// The runner writes the `wake` entries, not the graph.
		expect(transcript.map((e) => e.event.type)).toEqual([
			"command-start",
			"command-output",
			"command-exit",
			"wait",
			"command-start",
			"command-output",
			"command-exit",
			"wait",
			"command-start",
			"command-output",
			"command-exit",
		]);
		// One log file, every try appended.
		expect(
			await Bun.file(
				join(sandbox.dataDir, "logs", h.runId, `${stepId}.log`),
			).text(),
		).toBe("checking green\nchecking green\nchecking green\n");
	});

	test("a signal: no wake time, a timer wake keeps waiting, the wrong name is refused before the thread, and the right one ends it done", async () => {
		const time = clock();
		const h = await startRun(
			sandbox,
			flowOf({
				start: "deploy",
				nodes: [wait("deploy", { kind: "signal", name: "deployed" })],
				edges: [],
			}),
		);
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: {} });
		const [stepRow] = deriveSteps(await h.events());
		const stepId = stepRow?.id as string;
		expect(first.parked[0]).toEqual({
			kind: "wait",
			stepId,
			nodeId: "deploy",
			reason: "signal",
			until: null,
			message: 'Waits for the signal "deployed".',
		});
		expect(payloads(await h.events(), "WaitStarted")[0]).toEqual({
			reason: "signal",
			until: null,
			message: 'Waits for the signal "deployed".',
			since: time.now(),
			signal: "deployed",
		});
		// The engine refuses a signal of another name from the log alone.
		expect(deriveSleep(await h.events())).toMatchObject({
			signal: "deployed",
			until: null,
		});

		// A person's "wake now" is not the signal: the step sleeps on.
		time.advance(3);
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: true },
		});
		const woken = await drive(
			h,
			new Command({ resume: { kind: "wake", early: true } }),
			h.graph(),
		);
		expect(woken.parked[0]).toMatchObject({
			kind: "wait",
			stepId,
			reason: "signal",
			until: null,
		});
		expect(woken.state.pending).toMatchObject({ streak: { count: 2 } });
		expect(woken.state.pending).not.toHaveProperty("signal");

		// The signal arrives.
		time.advance(4);
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: true, signal: "deployed" },
		});
		const signalled = await drive(
			h,
			new Command({ resume: { kind: "signal", name: "deployed" } }),
			h.graph(),
		);
		expect(signalled.parked).toEqual([]);
		expect(signalled.state.ended?.status).toBe("finished");
		expect(signalled.state.nodes.deploy).toEqual({
			outcome: "done",
			waited_minutes: 7,
			visit: 1,
		});
	});

	test("timeoutMinutes bounds every kind: the wake time is cut to the deadline, and the wake ends the step timeout", async () => {
		const time = clock();
		const h = await startRun(
			sandbox,
			flowOf({
				start: "deploy",
				nodes: [
					wait(
						"deploy",
						{ kind: "signal", name: "deployed" },
						{ timeoutMinutes: 30 },
					),
					command("late", "echo late"),
				],
				edges: [{ id: "e1", from: "deploy", outcome: "timeout", to: "late" }],
			}),
		);
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;
		expect(first.parked[0]).toMatchObject({
			reason: "signal",
			until: time.now() + 30 * MINUTE,
		});
		time.advance(30);
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.state.ended?.nodeId).toBe("late");
		expect(second.state.nodes.deploy).toEqual({
			outcome: "timeout",
			waited_minutes: 30,
			visit: 1,
		});

		// A command past its deadline: the poll is not run again.
		const poll = await startRun(
			sandbox,
			flowOf({
				start: "ci",
				nodes: [
					wait(
						"ci",
						{ kind: "command", command: "false", everyMinutes: 10 },
						{ timeoutMinutes: 15 },
					),
				],
				edges: [],
			}),
		);
		poll.ctx.now = time.now;
		const polled = await drive(poll, { inputs: {} });
		expect(polled.parked[0]).toMatchObject({ until: time.now() + 10 * MINUTE });
		time.advance(10);
		const pollId = deriveSteps(await poll.events())[0]?.id as string;
		await poll.log.append({
			type: "WaitEnded",
			runId: poll.runId,
			stepId: pollId,
			payload: { early: false },
		});
		const again = await drive(
			poll,
			new Command({ resume: { kind: "wake", early: false } }),
			poll.graph(),
		);
		// Cut to the deadline: 5 minutes, not 10.
		expect(again.parked[0]).toMatchObject({ until: time.now() + 5 * MINUTE });
		time.advance(5);
		await poll.log.append({
			type: "WaitEnded",
			runId: poll.runId,
			stepId: pollId,
			payload: { early: false },
		});
		const out = await drive(
			poll,
			new Command({ resume: { kind: "wake", early: false } }),
			poll.graph(),
		);
		// No edge on timeout: the run parks as failed.
		expect(out.parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
			reason:
				'Node "ci" ended with "timeout" and no edge leaves it on that outcome.',
		});
		// The last output the command gave, from the step's log file.
		expect(out.state.nodes.ci).toEqual({
			outcome: "timeout",
			waited_minutes: 15,
			log_tail: "",
			visit: 1,
		});
		const transcript = await readTranscriptFile(
			deriveSteps(await poll.events())[0]?.transcriptPath as string,
		);
		expect(
			transcript.filter((e) => e.event.type === "command-start"),
		).toHaveLength(2);
	});
});
