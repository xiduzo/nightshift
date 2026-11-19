import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	beforeDeadline,
	START_DEADLINE_MS,
	START_TOO_LONG,
} from "./start-deadline";

/** The deadline of a start: a start that hangs gives up, and says so. */

describe("beforeDeadline", () => {
	test("gives what the work gives when it settles in time", async () => {
		expect(await beforeDeadline(1_000, async () => "started")).toBe("started");
		expect(START_DEADLINE_MS).toBe(4 * 60_000);
	});

	test("refuses a work that takes too long, and the work sees its signal aborted", async () => {
		let signal: AbortSignal | undefined;
		let release = () => {};
		const hanging = beforeDeadline(20, (deadline) => {
			signal = deadline;
			return new Promise<string>((resolve) => {
				release = () => resolve("late");
			});
		});
		const refused = await hanging.catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(Refusal);
		expect(refused).toMatchObject({
			kind: "unavailable",
			message: START_TOO_LONG,
		});
		expect(signal?.aborted).toBe(true);
		release();
	});

	test("passes on what the work throws", async () => {
		await expect(
			beforeDeadline(1_000, async () => {
				throw new Refusal("conflict", "The run cap is full.");
			}),
		).rejects.toThrow("The run cap is full.");
	});
});
