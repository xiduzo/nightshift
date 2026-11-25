import { describe, expect, test } from "bun:test";

import { BadArguments } from "./args";
import { leaveOptions, leaveQuestionLines, leaveResultLines } from "./leave";

describe("nightshift leave", () => {
	test("asks first, without flags", () => {
		expect(leaveOptions([], {})).toEqual({
			yes: false,
			daemon: "http://localhost:3000",
		});
		expect(leaveOptions(["-y"], {})).toMatchObject({ yes: true });
	});

	test("an unknown flag shows the help", () => {
		expect(() => leaveOptions(["--force"], {})).toThrow(BadArguments);
	});

	test("the question says that the Host keeps everything", () => {
		expect(leaveQuestionLines("studio")[0]).toBe(
			"This computer leaves studio. studio keeps all your projects, flows and runs.",
		);
	});

	test("the result says what Personal kept, and where the copy is", () => {
		expect(
			leaveResultLines({
				host: { id: "h", name: "studio" },
				told: true,
				split: {
					state: "done",
					spaceId: "s",
					projects: 2,
					runs: 1,
					unpinned: 0,
					backup: "/data/copy.db",
				},
				waiting: null,
				keyKept: false,
			}),
		).toEqual([
			"This computer left studio.",
			"Your Personal on this computer has 2 projects and 1 run.",
			"A copy of your data from before is in /data/copy.db",
		]);
	});

	test("the result says which schedules are paused here, and how to run them on this computer", () => {
		expect(
			leaveResultLines({
				host: { id: "h", name: "studio" },
				told: true,
				split: {
					state: "done",
					spaceId: "s",
					projects: 1,
					runs: 0,
					unpinned: 2,
					backup: "/data/copy.db",
				},
				waiting: null,
				keyKept: false,
			}),
		).toContain(
			"2 schedules ran on the Host. They are paused here. Turn them on to run them on this computer.",
		);
	});

	test("a Host that did not answer is to remove this computer too", () => {
		expect(
			leaveResultLines({
				host: { id: "h", name: "studio" },
				told: false,
				split: null,
				waiting: null,
				keyKept: false,
			}),
		).toEqual([
			"This computer left studio. It can still list this computer. Remove this computer on its Devices page too.",
			"Your Personal stays as it is.",
		]);
	});

	test("a key that stays on this computer is said", () => {
		expect(
			leaveResultLines({
				host: { id: "h", name: "studio" },
				told: true,
				split: null,
				waiting: null,
				keyKept: true,
			}),
		).toContain(
			"The old key stays on this computer. Night Shift tries again when it starts.",
		);
	});
});
