import { describe, expect, test } from "bun:test";
import {
	type LockScreenGate,
	lockScreenRefusal,
	NeedsApp,
} from "./lock-screen";

/** An open Gate of a run, on the step `step-<runId>`. */
const open = (runId: string, lockScreen = false): LockScreenGate => ({
	runId,
	stepId: `step-${runId}`,
	choices: [{ name: "yes" }, { name: "no" }],
	lockScreen,
	answerPending: false,
});

const answer = (runId: string, choice = "yes") => ({
	runId,
	stepId: `step-${runId}`,
	choice,
});

describe("lockScreenRefusal", () => {
	const marked = open("marked", true);
	const plain = open("plain");

	test("takes an answer for a Gate its author marked for the lock screen, with one of its choices", () => {
		expect(lockScreenRefusal([marked, plain], answer("marked"))).toBeNull();
	});

	test("needs the app for a Gate not marked for it, or a choice it does not have", () => {
		expect(lockScreenRefusal([marked, plain], answer("plain"))).toBe(
			"needs-app",
		);
		expect(
			lockScreenRefusal([marked], answer("marked", "approve-deploy")),
		).toBe("needs-app");
	});

	test("refuses a Gate that is not open, or has an answer on its way, as closed", () => {
		expect(lockScreenRefusal([plain], answer("marked"))).toBe("gate-closed");
		// Another step of the same run is not this Gate.
		expect(
			lockScreenRefusal([marked], { ...answer("marked"), stepId: "other" }),
		).toBe("gate-closed");
		expect(
			lockScreenRefusal([{ ...marked, answerPending: true }], answer("marked")),
		).toBe("gate-closed");
	});
});

describe("NeedsApp", () => {
	test("is a forbidden refusal that asks for the app", () => {
		const refusal = new NeedsApp();
		expect(refusal.kind).toBe("forbidden");
		expect(refusal.message).toBe("Open this Gate in Night Shift to answer it.");
	});
});
