import * as LocalAuthentication from "expo-local-authentication";

import {
	answerCheck,
	type CheckFailure,
	checkFailure,
	type PhoneLock,
} from "./answer-check";

/** How this phone is locked, from what the person set up in its Settings app. */
async function phoneLock(): Promise<PhoneLock> {
	const level = await LocalAuthentication.getEnrolledLevelAsync().catch(
		() => LocalAuthentication.SecurityLevel.NONE,
	);
	if (level === LocalAuthentication.SecurityLevel.NONE) return "none";
	if (level === LocalAuthentication.SecurityLevel.SECRET) return "passcode";
	return "biometric";
}

/**
 * Checks that the person holds the phone before an answer to this Gate
 * goes: Face ID or a fingerprint, else the passcode. A lock-screen Gate
 * needs no check. Null when the answer may go, else why it may not.
 */
export async function checkBeforeAnswer(gate: {
	lockScreen: boolean;
}): Promise<CheckFailure | null> {
	const next = answerCheck(gate, gate.lockScreen ? "none" : await phoneLock());
	if (next === "send") return null;
	if (next === "not-set-up") return "not-set-up";
	const result = await LocalAuthentication.authenticateAsync({
		promptMessage: "Send your answer",
		cancelLabel: "Cancel",
		disableDeviceFallback: false,
	}).catch(() => ({ success: false as const, error: "unknown" as const }));
	return result.success ? null : checkFailure(result.error);
}
