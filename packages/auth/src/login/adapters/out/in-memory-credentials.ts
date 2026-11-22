import type { Credentials } from "../../application/ports";

/** A Person as the in-memory `Credentials` keeps them. */
export type CredentialRecord = {
	id: string;
	email: string;
	name: string;
	emailVerified: boolean;
	twoFactorEnabled: boolean;
	/** The password, kept as it came: a twin hashes nothing. */
	password: string | null;
	/** The Person has a second factor (an authenticator and backup codes). */
	secondFactor: boolean;
};

/**
 * `Credentials` in memory. A test adds a Person (`add`) where the real
 * adapter would find one, and reads `records` after a call.
 */
export function inMemoryCredentials() {
	const records = new Map<string, CredentialRecord>();
	const known = (personId: string) => {
		const found = records.get(personId);
		if (!found) throw new Error(`No Person ${personId}.`);
		return found;
	};
	const twin = {
		records,
		/** Every call, in order: the method's name and the Person. */
		calls: [] as { method: keyof Credentials; personId: string }[],
		/** Adds a Person, as the real adapter would find them. */
		add(
			person: Pick<CredentialRecord, "id" | "email"> &
				Partial<CredentialRecord>,
		) {
			records.set(person.id, {
				name: person.id,
				emailVerified: false,
				twoFactorEnabled: false,
				password: null,
				secondFactor: false,
				...person,
			});
		},
		async hasPassword(personId: string) {
			twin.calls.push({ method: "hasPassword", personId });
			return records.get(personId)?.password != null;
		},
		async personOf(email: string) {
			for (const record of records.values()) {
				if (record.email === email) return record.id;
			}
			return null;
		},
		async updatePerson(
			personId: string,
			change: { email: string; name?: string; resetTwoFactor?: boolean },
		) {
			twin.calls.push({ method: "updatePerson", personId });
			const record = known(personId);
			record.email = change.email;
			record.emailVerified = true;
			if (change.name) record.name = change.name;
			if (change.resetTwoFactor) record.twoFactorEnabled = false;
		},
		async forgetSecondFactor(personId: string) {
			twin.calls.push({ method: "forgetSecondFactor", personId });
			const record = records.get(personId);
			if (record) record.secondFactor = false;
		},
		async savePassword(personId: string, password: string) {
			twin.calls.push({ method: "savePassword", personId });
			known(personId).password = password;
		},
	};
	return twin satisfies Credentials;
}

export type InMemoryCredentials = ReturnType<typeof inMemoryCredentials>;
