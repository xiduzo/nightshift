import { expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { checkScheduleOffers } from "./check-schedule-offers";

const schedule = { id: "night" } as Schedule;
const project = { id: "proj", flows: async () => ({}) };

function ports() {
	return {
		documents: {
			open: async () => ({ offers: { values: () => [] } }),
		},
		devicesFor: async () => [],
		keeper: async () => "host",
		offersHere: async () => [],
		personInSpace: async (_spaceId: string, personId: string) => personId,
		flowsForRun: () => ({ flow: { nodes: [] }, calledFlows: {} }),
	};
}

test("Night Shift's own schedules name no Person", async () => {
	const out = await checkScheduleOffers(ports())(
		project,
		"team",
		{ nightShift: true },
		[schedule],
	);
	expect(out).toEqual([schedule]);
});

test("a Host that offers nothing refuses the schedule", async () => {
	await expect(
		checkScheduleOffers(ports())(
			project,
			"team",
			{ personId: "ada", door: "session" },
			[schedule],
		),
	).rejects.toThrow(
		"Schedules run on the Host of this Space. Its owner offers you nothing there yet.",
	);
});
