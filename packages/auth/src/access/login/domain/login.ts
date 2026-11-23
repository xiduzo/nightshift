import { Refusal } from "@nightshift/refusal";

/**
 * A sign-in for a Person: an email and a password. This computer's Person
 * (the Host admin on a Host) has none: on this computer it is signed in
 * for you. A Host without a screen needs one before its admin can sign in
 * from a browser elsewhere and invite others: `nightshift admin` sets it,
 * on the Host itself.
 */
export type LoginInput = {
	email: string;
	password: string;
	name?: string;
	/**
	 * Also turn two-factor sign-in off: the way back in for a Person who
	 * lost their authenticator app and their backup codes. Only on the
	 * Host itself, like the rest of this.
	 */
	resetTwoFactor?: boolean;
};

export const MIN_PASSWORD_LENGTH = 8;

/**
 * The email a login signs in with, in lower case and without spaces
 * around it. Refuses an email that is not an address, and a short
 * password.
 */
export function loginEmail(input: LoginInput): string {
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Refusal("invalid", `${input.email} is not an email address.`);
	}
	if (input.password.length < MIN_PASSWORD_LENGTH) {
		throw new Refusal(
			"invalid",
			`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
		);
	}
	return email;
}

/** The refusal of an email that another Person signs in with. */
export function emailTaken(email: string): Refusal {
	return new Refusal("conflict", `Another Person here signs in with ${email}.`);
}
