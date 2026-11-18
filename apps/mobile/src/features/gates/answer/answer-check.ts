/**
 * Whether the phone checks that it is you before it sends an answer. Pure:
 * `person-check.ts` asks the phone, this decides.
 */

/** How the person unlocks this phone: Face ID or a fingerprint, only a passcode, or nothing. */
export type PhoneLock = "biometric" | "passcode" | "none";

/**
 * What happens before an answer goes out:
 * - `send`: a lock-screen Gate, answered at once.
 * - `check`: the phone asks for Face ID, a fingerprint or the passcode first.
 * - `not-set-up`: the Gate needs a check, but this phone has no lock.
 */
export type AnswerCheck = "send" | "check" | "not-set-up";

/**
 * The flow author marks the Gates that may be answered from the lock
 * screen. Every other Gate needs a check of the person on the phone, with
 * the passcode when the phone has no Face ID or fingerprint.
 */
export function answerCheck(
	gate: { lockScreen: boolean },
	lock: PhoneLock,
): AnswerCheck {
	if (gate.lockScreen) return "send";
	return lock === "none" ? "not-set-up" : "check";
}

/** Why a check did not let the answer go. */
export type CheckFailure = "cancelled" | "not-set-up" | "locked-out" | "failed";

/** The error of `expo-local-authentication`, as the reason the person reads. */
export function checkFailure(error: string): CheckFailure {
	switch (error) {
		case "user_cancel":
		case "system_cancel":
		case "app_cancel":
		case "user_fallback":
			return "cancelled";
		case "not_enrolled":
		case "not_available":
		case "passcode_not_set":
			return "not-set-up";
		case "lockout":
			return "locked-out";
		default:
			return "failed";
	}
}

/** What the person reads when the answer did not go out: what happened, and what to do. */
export const CHECK_COPY: Record<
	CheckFailure,
	{ title: string; description: string }
> = {
	cancelled: {
		title: "Your answer was not sent",
		description: "You cancelled the check. Tap Send to try again.",
	},
	"not-set-up": {
		title: "Add a screen lock to answer",
		description:
			"This Gate needs Face ID, a fingerprint or a passcode. Add one in the Settings app of your phone. Then send your answer again.",
	},
	"locked-out": {
		title: "Your phone stopped the check",
		description:
			"You tried too many times. Unlock your phone with its passcode. Then send your answer again.",
	},
	failed: {
		title: "Your phone could not check that it is you",
		description: "Your answer was not sent. Tap Send to try once more.",
	},
};
