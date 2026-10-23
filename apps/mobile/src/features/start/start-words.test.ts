/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
	canRun,
	flowCaption,
	placementHint,
	startBlocker,
} from "./start-words";

describe("the flow rows", () => {
	test("a flow that is not valid cannot start", () => {
		expect(canRun({ nodeCount: 4, errorCount: 0 })).toBe(true);
		expect(canRun({ nodeCount: null, errorCount: 0 })).toBe(false);
		expect(canRun({ nodeCount: 4, errorCount: 2 })).toBe(false);
	});

	test("the caption is the description, or why the flow cannot start", () => {
		expect(
			flowCaption({ nodeCount: 4, errorCount: 0, description: "Ships it" }),
		).toBe("Ships it");
		expect(
			flowCaption({ nodeCount: 4, errorCount: 0, description: null }),
		).toBeUndefined();
		expect(
			flowCaption({ nodeCount: 4, errorCount: 1, description: "Ships it" }),
		).toBe("Not valid. Fix it in Night Shift on your computer.");
	});
});

test("placementHint says what each place is", () => {
	expect(placementHint({ online: false, thisDevice: false })).toBe(
		"Offline. Open Night Shift on that computer to run flows on it.",
	);
	expect(placementHint({ online: true, thisDevice: true })).toBe("Your Host.");
	expect(placementHint({ online: true, thisDevice: false })).toBe(
		"One of your computers.",
	);
	expect(
		placementHint({ online: true, thisDevice: false, offers: ["claude"] }),
	).toBe("Another person offers this computer to the Space, with claude.");
	expect(placementHint({ online: true, thisDevice: false, offers: [] })).toBe(
		"Another person offers this computer to the Space, with no profiles.",
	);
});

describe("startBlocker", () => {
	const ok = {
		flowChosen: true,
		missing: [],
		badJson: [],
		placementsLoaded: true,
		hasPlace: true,
	};

	test("is null when the run can start", () => {
		expect(startBlocker(ok)).toBeNull();
	});

	test("asks for the flow first, then the inputs, then the computer", () => {
		expect(startBlocker({ ...ok, flowChosen: false, hasPlace: false })).toBe(
			"Choose a flow first.",
		);
		expect(
			startBlocker({
				...ok,
				missing: [
					{ name: "ticket", label: "Ticket" },
					{ name: "repo", label: "" },
				],
				badJson: [{ name: "plan", label: "Plan" }],
			}),
		).toBe("Fill in Ticket, repo first.");
		expect(
			startBlocker({ ...ok, badJson: [{ name: "plan", label: "Plan" }] }),
		).toBe("Check the format of Plan first.");
		expect(startBlocker({ ...ok, hasPlace: false })).toBe(
			"No computer can take the run now.",
		);
	});

	test("does not blame the computer while the computers load", () => {
		expect(
			startBlocker({ ...ok, placementsLoaded: false, hasPlace: false }),
		).toBeNull();
	});
});
