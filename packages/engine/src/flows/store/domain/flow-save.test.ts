import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	checkFlowName,
	flowNotFound,
	newerFlow,
	unreadableSchedules,
} from "./flow-save";

describe("the words of a flow's save", () => {
	test("a name no flow may have is refused as invalid", () => {
		let error: unknown;
		try {
			checkFlowName("Not a name!");
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Refusal);
		expect((error as Refusal).kind).toBe("invalid");
		expect((error as Error).message).toStartWith(
			'The flow name "Not a name!" is not valid. ',
		);
		expect(() => checkFlowName("build")).not.toThrow();
	});

	test("a flow of a newer Night Shift, and one that does not exist", () => {
		expect(newerFlow("build").kind).toBe("conflict");
		expect(newerFlow("build").message).toBe(
			'A newer version of Night Shift saved the flow "build". Update Night Shift to change it.',
		);
		expect(flowNotFound("build").kind).toBe("not-found");
		expect(flowNotFound("build").message).toBe(
			'The flow "build" does not exist.',
		);
	});

	test("schedules of a newer Night Shift give one warning", () => {
		expect(unreadableSchedules(0)).toEqual([]);
		expect(unreadableSchedules(2)).toEqual([
			{
				severity: "warning",
				message:
					"A newer version of Night Shift saved some schedules. Update Night Shift to see them.",
			},
		]);
	});
});
