/**
 * Two-factor sign-in in the browser: the words for Better Auth's errors,
 * and the setup key a person types into an authenticator app.
 */

/** A Better Auth client error: its code, status and message. */
export type AuthError = {
	code?: string;
	status?: number;
	message?: string;
};

const MESSAGES: Record<string, string> = {
	INVALID_CODE: "This code is not correct. Enter the code your app shows now.",
	INVALID_BACKUP_CODE:
		"This backup code is not correct, or you used it before.",
	INVALID_PASSWORD: "The password is not correct.",
	INVALID_EMAIL_OR_PASSWORD: "The email or the password is not correct.",
	TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE:
		"Too many wrong codes. Sign in again with your email and password.",
	INVALID_TWO_FACTOR_COOKIE:
		"Your sign-in timed out. Sign in again with your email and password.",
	ACCOUNT_TEMPORARILY_LOCKED:
		"Too many wrong codes. Wait 15 minutes, then try again.",
	TOTP_ALREADY_ENABLED: "Two-factor sign-in is already on.",
	TWO_FACTOR_NOT_ENABLED: "Two-factor sign-in is off.",
	// The daemon's refusal until two-factor is on: TWO_FACTOR_REQUIRED in shared/api.
	// A plain key, so this file does not load the API client.
	TWO_FACTOR_REQUIRED:
		"This Host asks for two-factor sign-in. Turn it on for your account to continue.",
};

/** Plain words for a Better Auth error, else `fallback`. */
export function authErrorMessage(
	error: AuthError | null | undefined,
	fallback = "Something went wrong. Try again.",
): string {
	if (!error) return fallback;
	if (error.status === 429) {
		return "Too many tries. Wait a minute, then try again.";
	}
	return (error.code && MESSAGES[error.code]) || fallback;
}

/**
 * The setup key in a setup link (`otpauth://totp/...?secret=...`), in
 * groups of four, for a person who cannot scan the QR code.
 */
export function setupKeyOf(totpURI: string): string {
	let secret = "";
	try {
		secret = new URL(totpURI).searchParams.get("secret") ?? "";
	} catch {
		return "";
	}
	return secret.match(/.{1,4}/g)?.join(" ") ?? "";
}

/** The backup codes as a text file: one per line. */
export function backupCodesFile(
	codes: readonly string[],
	email: string,
): string {
	return [
		`Night Shift backup codes for ${email}`,
		"Each code signs you in once, when you do not have your authenticator app.",
		"",
		...codes,
		"",
	].join("\n");
}
