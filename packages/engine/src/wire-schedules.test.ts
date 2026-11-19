import { describe, expect, spyOn, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { createScheduleNotices } from "./wire-schedules";

/** What the schedules slice tells, and who hears it. */

const missed = {
	projectId: "project-1",
	scheduleId: "nightly",
	flow: "night",
	at: 1_800_000_000_000,
};

/** Lets the promise callbacks that are due run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function notices() {
	return createScheduleNotices({
		spaceOf: async (projectId) => {
			if (projectId !== "project-1") {
				throw new Refusal("not-found", "Night Shift cannot find this project.");
			}
			return "space-1";
		},
	});
}

describe("a missed cron time", () => {
	test("reaches every listener, with the Space of its project", async () => {
		const told = notices();
		const first: unknown[] = [];
		const second: unknown[] = [];
		told.onMissed((time) => first.push(time));
		told.onMissed((time) => second.push(time));
		told.notices.missed(missed);
		await settle();
		expect(first).toEqual([{ ...missed, spaceId: "space-1" }]);
		expect(second).toEqual(first);
	});

	test("a listener that left hears nothing more", async () => {
		const told = notices();
		const heard: unknown[] = [];
		const leave = told.onMissed((time) => heard.push(time));
		leave();
		told.notices.missed(missed);
		await settle();
		expect(heard).toEqual([]);
	});

	test("a project that is gone is logged, and nobody is told", async () => {
		const told = notices();
		const heard: unknown[] = [];
		told.onMissed((time) => heard.push(time));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			told.notices.missed({ ...missed, projectId: "gone" });
			await settle();
			expect(logged.mock.calls[0]?.[0]).toBe(
				"[schedules] could not tell of a missed time",
			);
		} finally {
			logged.mockRestore();
		}
		expect(heard).toEqual([]);
	});
});

describe("a change of a project's schedules", () => {
	test("waits for every listener, in the order they came", async () => {
		const told = notices();
		const heard: string[] = [];
		told.onChanged(async (spaceId, projectId) => {
			await settle();
			heard.push(`first ${spaceId} ${projectId}`);
		});
		told.onChanged(async () => {
			heard.push("second");
		});
		await told.notices.changed("space-1", "project-1");
		expect(heard).toEqual(["first space-1 project-1", "second"]);
	});

	test("with nobody listening it does nothing", async () => {
		await notices().notices.changed("space-1", "project-1");
	});

	test("a listener that fails fails the change, and one that left hears nothing", async () => {
		const told = notices();
		const failure = new Error("the stream is gone");
		const leave = told.onChanged(async () => {
			throw failure;
		});
		expect(
			await told.notices.changed("space-1", "project-1").then(
				() => null,
				(error: unknown) => error,
			),
		).toBe(failure);
		leave();
		await told.notices.changed("space-1", "project-1");
	});
});
