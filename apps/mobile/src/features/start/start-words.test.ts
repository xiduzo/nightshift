/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
	chosenFlow,
	flowCaption,
	phoneInputs,
	placementHint,
	readsFlowFile,
	startBlocker,
} from "./start-words";

describe("the flow rows", () => {
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
		"Offline. Open Night Shift on it to use it.",
	);
	expect(placementHint({ online: true, thisDevice: true })).toBe(
		"Host · online",
	);
	expect(placementHint({ online: true, thisDevice: false })).toBe(
		"Your computer · online",
	);
	expect(
		placementHint({ online: true, thisDevice: false, lastRun: true }),
	).toBe("Your computer · online · ran the last run");
	expect(
		placementHint({ online: true, thisDevice: false, offers: ["claude"] }),
	).toBe("Another person offers it, with claude · online");
	expect(placementHint({ online: true, thisDevice: false, offers: [] })).toBe(
		"Another person offers it, with no profiles · online",
	);
});

describe("phoneInputs", () => {
	const ticket = { name: "ticket", type: "text" as const, required: true };
	const branch = {
		name: "branch",
		type: "text" as const,
		required: true,
		default: "main",
	};
	const note = { name: "note", type: "text" as const, required: false };
	const dry = { name: "dry", type: "boolean" as const, required: true };

	test("asks only for what the run cannot start without", () => {
		expect(phoneInputs([ticket, branch, note, dry])).toEqual({
			needed: [ticket],
			more: true,
		});
	});

	test("says when the flow has no other inputs", () => {
		expect(phoneInputs([ticket])).toEqual({ needed: [ticket], more: false });
		expect(phoneInputs([])).toEqual({ needed: [], more: false });
		expect(phoneInputs([note])).toEqual({ needed: [], more: true });
	});
});

test("placementHint names the Host admin of a Host that another person runs", () => {
	expect(
		placementHint({
			online: true,
			thisDevice: true,
			offers: [],
			ownerName: "Ada",
		}),
	).toBe("This Host belongs to Ada. Ada has not offered it to this Space.");
	expect(
		placementHint({
			online: true,
			thisDevice: true,
			offers: ["builder"],
			ownerName: "Ada",
		}),
	).toBe("This Host belongs to Ada. Ada offers builder to this Space.");
	expect(placementHint({ online: true, thisDevice: true, offers: [] })).toBe(
		"This Host belongs to another person. It offers no profiles to this Space.",
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
