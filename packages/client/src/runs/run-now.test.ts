import { describe, expect, test } from "bun:test";

import { openGates, type RunLive, runNow } from "./run-now";
import type { RunStatus, StepSummary } from "./types";

const here = { id: "this", thisDevice: true, name: null };
const laptop = { id: "laptop", thisDevice: false, name: "Sander's laptop" };
const unnamed = { id: "unnamed", thisDevice: false, name: null };

type Run = Parameters<typeof runNow>[0];

const run = (over: Partial<Run> = {}): Run => ({
	status: "running",
	result: null,
	reason: null,
	walker: here,
	wakeAt: null,
	signal: null,
	commands: [],
	steps: [],
	...over,
});

/** A step of a Gate node: open until it ends. */
const gateStep = (
	id: string,
	startedAt: number,
	endedAt: number | null = null,
	scope: StepSummary["scope"] = null,
) =>
	({
		id,
		nodeId: `node-${id}`,
		startedAt,
		endedAt,
		outcome: endedAt === null ? null : "approve",
		scope,
		gate: {
			question: "Ship it?",
			choices: [],
			openedAt: startedAt,
			deadline: null,
		},
	}) as unknown as StepSummary;

const notice = (
	status: RunStatus,
	over: Partial<Run> = {},
	live: RunLive = {},
) => runNow(run({ status, ...over }), live).notice;

describe("the status a run shows", () => {
	test("the live status wins over the run as read", () => {
		const now = runNow(run({ status: "running" }), { status: "sleeping" });
		expect(now).toMatchObject({
			status: "sleeping",
			word: "Sleeping",
			group: "running",
			ended: false,
		});
		expect(runNow(run(), { status: null }).status).toBe("running");
	});

	test("a run that had nothing to do reads so", () => {
		expect(
			runNow(run({ status: "finished", result: "nothing-to-do" })),
		).toMatchObject({
			key: "nothing-to-do",
			word: "Nothing to do",
			ended: true,
		});
	});

	test("an action on its way shows its result at once", () => {
		const stop = { action: "stop", settled: false } as const;
		expect(runNow(run(), { acting: stop }).status).toBe("stopped");
		// What the run allows still follows its own status.
		expect(runNow(run(), { acting: stop }).allows.stop).toBe(true);
	});

	test("a stop that Night Shift took shows stopped until the run stops, then the run's own status", () => {
		const acting = { action: "stop", settled: true } as const;
		expect(runNow(run(), { acting }).status).toBe("stopped");
		expect(runNow(run({ status: "stopped" }), { acting }).status).toBe(
			"stopped",
		);
		const ended = runNow(run({ status: "finished", result: "done" }), {
			acting,
		});
		expect([ended.status, ended.result]).toEqual(["finished", "done"]);
	});

	test("a resume and a run again show the run on its way until it runs", () => {
		for (const action of ["resume", "rerun"] as const) {
			for (const settled of [false, true]) {
				const shown = runNow(run({ status: "failed" }), {
					acting: { action, settled },
				});
				expect([shown.status, shown.result]).toEqual(["running", null]);
			}
			expect(runNow(run(), { acting: { action, settled: true } }).status).toBe(
				"running",
			);
		}
	});

	test("a step restart keeps the run running, and a run that ended meanwhile shows how", () => {
		const acting = { action: "restart", settled: true } as const;
		expect(runNow(run(), { acting }).status).toBe("running");
		expect(runNow(run({ status: "stopped" }), { acting }).status).toBe(
			"stopped",
		);
	});
});

describe("what a run allows", () => {
	test("each action, and why not, from the engine's one rule", () => {
		const now = runNow(run({ status: "failed", result: "failed" }));
		expect(now.allows.rerun).toBe(true);
		expect(now.allows.resume).toBe(false);
		expect(now.whyNot.resume).toBe(
			"This run ended where its flow ends it. Run it again from a step instead.",
		);
		expect(now.whyNot.rerun).toBeNull();
	});

	test("a run another computer walks allows only what travels to it", () => {
		const now = runNow(run({ status: "running", walker: laptop }));
		expect(now.allows).toMatchObject({ stop: true, restart: false });
		expect(now.whyNot.stop).toBeNull();
		expect(now.whyNot.restart).not.toBeNull();
	});
});

describe("the Gate a run waits at", () => {
	test("the oldest open Gate, at any depth, while the run waits", () => {
		const steps = [
			gateStep("closed", 1, 2),
			gateStep("inner", 5, null, { parentStepId: "call", itemId: null }),
			gateStep("newer", 9),
		];
		expect(runNow(run({ status: "waiting", steps })).gate?.id).toBe("inner");
		// The live steps win over the run as read.
		expect(
			runNow(run({ status: "waiting", steps }), {
				steps: [gateStep("live", 3)],
			}).gate?.id,
		).toBe("live");
	});

	test("none while the run does not wait, even with a Gate left open", () => {
		const steps = [gateStep("left", 1)];
		expect(runNow(run({ status: "interrupted", steps })).gate).toBeNull();
		expect(openGates(steps).map((step) => step.id)).toEqual(["left"]);
	});
});

describe("what a waiting run needs", () => {
	const steps = [gateStep("review", 1)];

	test("an answer at its Gate, here or in the inbox", () => {
		expect(notice("waiting", { steps })).toEqual({
			kind: "gate",
			title: ["Waiting for your answer"],
			gist: "At the gate node-review",
			body: [
				"The run waits at the gate ",
				{ code: "node-review" },
				" until someone answers it.",
			],
			actions: ["answer", "open-inbox"],
			resumable: false,
			wakeAt: null,
			signal: null,
		});
	});

	test("an answer sent to the computer that walks the run applies when it is online", () => {
		const commands = [
			{ id: "c", kind: "gate.resolve", createdAt: 1 },
		] as Run["commands"];
		expect(
			notice("waiting", { steps, commands, walker: laptop }),
		).toMatchObject({
			kind: "answer-sent",
			title: ["Answer sent"],
			gist: "It applies when Sander's laptop is online.",
			body: [
				"Your answer is on its way to Sander's laptop. The run continues when Sander's laptop is online.",
			],
			actions: [],
		});
		expect(notice("waiting", { steps, commands, walker: unnamed })?.gist).toBe(
			"It applies when another device is online.",
		);
		// This computer walks it: the answer applies at once.
		expect(notice("waiting", { steps, commands })?.kind).toBe("gate");
	});

	test("nothing while no open Gate is known yet", () => {
		expect(notice("waiting")).toBeNull();
	});
});

describe("what a sleeping run needs", () => {
	test("a signal, sent here or from another system, with its timeout", () => {
		expect(notice("sleeping", { signal: "deployed", wakeAt: 500 })).toEqual({
			kind: "signal",
			title: ["Waiting for signal ", { code: "deployed" }],
			gist: "Send deployed to continue.",
			body: [
				"The flow continues when the run gets the signal ",
				{ code: "deployed" },
				", or times out at ",
				{ time: 500 },
				". Send it here, or from another system through the API.",
			],
			actions: ["send-signal"],
			resumable: false,
			wakeAt: 500,
			signal: "deployed",
		});
		expect(
			notice(
				"sleeping",
				{},
				{
					wait: { reason: "signal", until: null, message: "", signal: "go" },
				},
			)?.body,
		).toEqual([
			"The flow continues when the run gets the signal ",
			{ code: "go" },
			". Send it here, or from another system through the API.",
		]);
	});

	test("a Wait node's wait continues by itself, and can be woken now", () => {
		expect(
			notice(
				"sleeping",
				{ wakeAt: 900 },
				{
					wait: { reason: "duration", until: 800, message: "" },
				},
			),
		).toEqual({
			kind: "wait",
			title: ["Waiting"],
			gist: "The flow waits a while.",
			body: [
				"The flow waits a while. It continues",
				" at ",
				{ time: 900 },
				".",
			],
			actions: ["wake"],
			resumable: false,
			wakeAt: 900,
			signal: null,
		});
	});

	test("a sleep of the run policy says why, and how it goes on", () => {
		const sleeping = (
			reason: "usage-limit" | "command" | "device-offline",
			message = "",
		) => notice("sleeping", {}, { wait: { reason, until: 700, message } });
		expect(sleeping("usage-limit", "Resets at 5 pm")).toMatchObject({
			kind: "sleep",
			title: ["Sleeping"],
			gist: "The agent hit its usage limit.",
			body: [
				"The agent hit its usage limit. It continues where it stopped",
				" at ",
				{ time: 700 },
				".",
				"\nResets at 5 pm",
			],
			wakeAt: 700,
		});
		expect(sleeping("command")?.body[0]).toBe(
			"The flow waits for a command to pass. It tries the command again",
		);
		expect(sleeping("device-offline")?.body[0]).toBe(
			"The device of the next step is offline. It checks for the device again",
		);
	});

	test("before the stream tells why, the run sleeps", () => {
		expect(notice("sleeping")).toMatchObject({
			kind: "sleep",
			title: ["Sleeping"],
			gist: "The run sleeps.",
			body: ["The run sleeps. It continues where it stopped", "."],
			wakeAt: null,
		});
	});

	test("a run another computer walks wakes from here too", () => {
		expect(notice("sleeping", { walker: laptop })?.actions).toEqual(["wake"]);
	});
});

describe("why a run ended", () => {
	test("a run on its way says nothing", () => {
		expect(notice("running")).toBeNull();
	});

	test("a stopped run offers to resume it here", () => {
		expect(notice("stopped")).toEqual({
			kind: "stopped",
			title: ["The run stopped"],
			gist: "Resume it to continue.",
			body: [
				"The run stopped before its end. Resume it to continue where it stopped.",
			],
			actions: [],
			resumable: true,
			wakeAt: null,
			signal: null,
		});
	});

	test("a run another computer runs resumes from here too", () => {
		const failed = notice("failed", { walker: laptop });
		expect(failed?.body).toEqual(["The run failed. Resume it to continue."]);
		expect(failed?.resumable).toBe(true);
		expect(notice("stopped", { walker: unnamed })?.gist).toBe(
			"Resume it to continue.",
		);
	});

	test("the reason comes first, its first line is the gist", () => {
		const failed = notice("failed", {
			reason: "\nThe agent hit its turn limit.\nMore detail.",
		});
		expect(failed?.gist).toBe("The agent hit its turn limit.");
		expect(failed?.body).toEqual([
			"\nThe agent hit its turn limit.\nMore detail.",
		]);
		expect(failed?.resumable).toBe(true);
	});

	test("an interrupted run adds what to do after its reason", () => {
		expect(notice("interrupted")?.body).toEqual([
			"Night Shift stopped during this run. Resume it to continue where it stopped.",
		]);
	});

	test("a flow that ended as failed is run again, not resumed", () => {
		expect(
			notice("failed", { result: "failed", reason: "Tests fail" }),
		).toMatchObject({
			kind: "ended-failed",
			title: ["The flow ended as failed"],
			gist: "Tests fail",
			body: ["Tests fail\nFix what it found, then run it again from a step."],
			resumable: false,
		});
	});

	test("a finished run speaks only with an End node's message, or its report", () => {
		expect(notice("finished")).toBeNull();
		expect(notice("finished", { result: "done" })).toBeNull();
		expect(
			notice("finished", { result: "nothing-to-do", reason: "No open issues" }),
		).toMatchObject({
			kind: "nothing-to-do",
			title: ["Nothing to do"],
			body: ["No open issues"],
		});
		expect(notice("finished", { result: "done" }, { report: true })).toEqual({
			kind: "done",
			title: ["Done"],
			gist: "The run wrote a report.",
			body: [],
			actions: ["read-report"],
			resumable: false,
			wakeAt: null,
			signal: null,
		});
		expect(
			notice("finished", { result: "nothing-to-do" }, { report: true })?.kind,
		).toBe("nothing-to-do");
	});

	test("an ended run with a report offers it beside the reason", () => {
		expect(notice("stopped", {}, { report: true })?.actions).toEqual([
			"read-report",
		]);
		// Only a finished run speaks through its report alone.
		expect(notice("running", {}, { report: true })).toBeNull();
	});
});
