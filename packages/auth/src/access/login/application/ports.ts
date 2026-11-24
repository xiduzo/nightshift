/**
 * The driven ports of login. The adapters of its own ports sit
 * in `adapters/out/`.
 */

/** The email and password each Person signs in with. */
export type Credentials = {
	/** Whether the Person has a password to sign in with. */
	hasPassword(personId: string): Promise<boolean>;
	/** The Person who signs in with that email (lower case), or null. */
	personOf(email: string): Promise<string | null>;
	/**
	 * Gives the Person the email (as verified) and, when given, a name.
	 * `resetTwoFactor` also turns their two-factor sign-in off.
	 */
	updatePerson(
		personId: string,
		change: { email: string; name?: string; resetTwoFactor?: boolean },
	): Promise<void>;
	/** Forgets the Person's second factor: their authenticator and backup codes. */
	forgetSecondFactor(personId: string): Promise<void>;
	/** Gives the Person this password: a new one, or in place of the old. */
	savePassword(personId: string, password: string): Promise<void>;
};

/** The sessions of the Persons: each signed-in screen holds one. */
export type SessionStore = {
	/** Ends the Person's session of that id. False when they have none of that id. */
	end(personId: string, sessionId: string): Promise<boolean>;
	/** Which of these sessions exist and have not expired at `at`. */
	live(sessionIds: readonly string[], at: number): Promise<Set<string>>;
};
