import { describe, expect, test } from "bun:test";
import { resumeGrace } from "./resume-grace";

/** The grace timer before the interrupted runs continue on their own. */

/** Waits `ms` of real time: the grace is a real timer. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(signal?: AbortSignal) {
	const resumed: string[] = [];
	const grace = resumeGrace({
		graceMs: 5,
		...(signal ? { signal } : {}),
		resume: async (runId) => {
			resumed.push(runId);
		},
	});
	return { grace, resumed };
}

describe("resumeGrace", () => {
	test("the kept runs continue once the grace after arm ends, each once", async () => {
		const { grace, resumed } = setup();
		grace.keep(["run-1", "run-2"]);
		await pause(20);
		expect(resumed).toEqual([]);
		grace.arm();
		await pause(30);
		expect(resumed).toEqual(["run-1", "run-2"]);
		grace.arm();
		await pause(20);
		expect(resumed).toEqual(["run-1", "run-2"]);
	});

	test("the runs kept last replace the runs kept before", async () => {
		const { grace, resumed } = setup();
		grace.keep(["run-1"]);
		grace.keep(["run-2"]);
		grace.arm();
		await pause(30);
		expect(resumed).toEqual(["run-2"]);
	});

	test("an engine that stops drops the timer", async () => {
		const lifetime = new AbortController();
		const { grace, resumed } = setup(lifetime.signal);
		grace.keep(["run-1"]);
		grace.arm();
		lifetime.abort();
		await pause(30);
		expect(resumed).toEqual([]);
	});

	test("a stopped engine arms nothing", async () => {
		const lifetime = new AbortController();
		lifetime.abort();
		const { grace, resumed } = setup(lifetime.signal);
		grace.keep(["run-1"]);
		grace.arm();
		await pause(30);
		expect(resumed).toEqual([]);
	});
});
