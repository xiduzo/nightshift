/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
	canRun,
	chosenFlow,
	flowCaption,
	placementHint,
	readsFlowFile,
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

describe("the chosen flow", () => {
	const who = { name: "who", type: "text" as const, required: false };
	const row = { nodeCount: 3, errorCount: 0, inputs: [who] };

	test("comes from its row in the list when the Host says its inputs there", () => {
		expect(readsFlowFile(row)).toBe(false);
		expect(chosenFlow(row, undefined)).toEqual({ inputs: [who], valid: true });
		expect(chosenFlow({ ...row, errorCount: 1 }, undefined)?.valid).toBe(false);
	});

	test("comes from its file when an older Host leaves the inputs out of the list", () => {
		const old = { nodeCount: 3, errorCount: 0 } as typeof row;
		expect(readsFlowFile(old)).toBe(true);
		expect(chosenFlow(old, undefined)).toBeNull();
		expect(chosenFlow(old, { flow: { inputs: [who] } })).toEqual({
			inputs: [who],
			valid: true,
		});
		expect(chosenFlow(old, { flow: null })).toEqual({
			inputs: [],
			valid: false,
		});
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
		placementHint({ online: true, thisDevice: false, lastRun: true }),
	).toBe("One of your computers. The last run of this project ran here.");
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
