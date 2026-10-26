import { describe, expect, test } from "bun:test";
import { runTime } from "./time";

const MIN = 60_000;

function step(
	id: string,
	startedAt: number,
	endedAt: number | null,
	options: { gateAt?: number; parent?: string } = {},
) {
	return {
		id,
		startedAt,
		endedAt,
		gate:
			options.gateAt === undefined
				? null
				: {
						question: "?",
						choices: [],
						openedAt: options.gateAt,
						deadline: null,
					},
		scope: options.parent
			? { parentStepId: options.parent, itemId: null }
			: null,
	};
}

describe("runTime", () => {
	test("leaves a past Gate's wait out of the active time", () => {
		const time = runTime(
			[
				step("a", 0, 10 * MIN),
				step("gate", 10 * MIN, 25 * MIN, { gateAt: 10 * MIN }),
				step("b", 25 * MIN, 30 * MIN),
			],
			0,
			99 * MIN,
		);
		expect(time).toEqual({
			open: 30 * MIN,
			waited: 15 * MIN,
			active: 15 * MIN,
			going: false,
		});
	});

	test("pauses the active time while a Gate waits", () => {
		const steps = [
			step("a", 0, 10 * MIN),
			step("gate", 10 * MIN, null, { gateAt: 10 * MIN }),
		];
		expect(runTime(steps, 0, 20 * MIN).active).toBe(10 * MIN);
		expect(runTime(steps, 0, 40 * MIN).active).toBe(10 * MIN);
		expect(runTime(steps, 0, 40 * MIN).waited).toBe(30 * MIN);
	});

	test("counts a Gate as work while another step runs", () => {
		const time = runTime(
			[step("gate", 0, null, { gateAt: 0 }), step("agent", 0, 10 * MIN)],
			0,
			15 * MIN,
		);
		expect(time.waited).toBe(5 * MIN);
	});

	test("waits inside a called flow, not in the Call step around it", () => {
		const time = runTime(
			[
				step("call", 0, null),
				step("inner", 0, 5 * MIN, { parent: "call" }),
				step("gate", 5 * MIN, null, { gateAt: 5 * MIN, parent: "call" }),
			],
			0,
			20 * MIN,
		);
		expect(time.waited).toBe(15 * MIN);
	});
});
