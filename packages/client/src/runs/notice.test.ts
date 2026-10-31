import { describe, expect, test } from "bun:test";

import { stoppedNotice } from "./notice";

const here = { thisDevice: true, name: null } as never;
const laptop = { thisDevice: false, name: "Sander's laptop" } as never;
const unnamed = { thisDevice: false, name: null } as never;

const run = (over: Partial<Parameters<typeof stoppedNotice>[0]> = {}) => ({
	reason: null,
	result: null,
	walker: here,
	...over,
});

describe("what a run that ended says", () => {
	test("a run on its way says nothing", () => {
		for (const status of ["running", "waiting", "sleeping"] as const) {
			expect(stoppedNotice(run(), status)).toBeNull();
		}
	});

	test("a stopped run offers to resume it here", () => {
		expect(stoppedNotice(run(), "stopped")).toEqual({
			tone: "stopped",
			title: "The run stopped",
			gist: "Resume it to continue.",
			body: "The run stopped before its end. Resume it to continue where it stopped.",
			resumable: true,
		});
	});

	test("a run another computer runs says only that computer can resume it", () => {
		const notice = stoppedNotice(run({ walker: laptop }), "failed");
		expect(notice?.body).toBe(
			"The run failed. Only Sander's laptop can resume it.",
		);
		expect(notice?.resumable).toBe(false);
		expect(stoppedNotice(run({ walker: unnamed }), "stopped")?.gist).toBe(
			"Only another device can resume it.",
		);
	});

	test("the reason comes first, its first line is the gist", () => {
		const notice = stoppedNotice(
			run({ reason: "\nThe agent hit its turn limit.\nMore detail." }),
			"failed",
		);
		expect(notice?.gist).toBe("The agent hit its turn limit.");
		expect(notice?.body).toBe("\nThe agent hit its turn limit.\nMore detail.");
		expect(notice?.resumable).toBe(true);
	});

	test("an interrupted run adds what to do after its reason", () => {
		expect(stoppedNotice(run(), "interrupted")?.body).toBe(
			"Night Shift stopped during this run. Resume it to continue where it stopped.",
		);
	});

	test("a flow that ended as failed is run again, not resumed", () => {
		const notice = stoppedNotice(
			run({ result: "failed", reason: "Tests fail" }),
			"failed",
		);
		expect(notice).toEqual({
			tone: "ended-failed",
			title: "The flow ended as failed",
			gist: "Tests fail",
			body: "Tests fail\nFix what it found, then run it again from a step.",
			resumable: false,
		});
	});

	test("a finished run speaks only with an End node's message", () => {
		expect(stoppedNotice(run(), "finished")).toBeNull();
		expect(stoppedNotice(run({ result: "done" }), "finished")).toBeNull();
		expect(
			stoppedNotice(
				run({ result: "nothing-to-do", reason: "No open issues" }),
				"finished",
			),
		).toMatchObject({ tone: "nothing-to-do", title: "Nothing to do" });
	});
});
