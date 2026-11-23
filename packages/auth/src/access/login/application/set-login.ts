import { emailTaken, type LoginInput, loginEmail } from "../domain/login";
import type { Credentials } from "./ports";

export type SetLoginPorts = {
	credentials: Pick<
		Credentials,
		"personOf" | "updatePerson" | "forgetSecondFactor" | "savePassword"
	>;
};

/** Whose login, and what it becomes. */
export type SetLogin = { personId: string; input: LoginInput };

/**
 * Sets the Person's email (and name), and their password: a new one, or
 * in place of the old. Refuses an email that another Person signs in with.
 */
export const setLogin =
	(ports: SetLoginPorts) =>
	async (request: SetLogin): Promise<{ email: string }> => {
		const { personId, input } = request;
		const email = loginEmail(input);
		const other = await ports.credentials.personOf(email);
		if (other !== null && other !== personId) throw emailTaken(email);
		const name = input.name?.trim();
		await ports.credentials.updatePerson(personId, {
			email,
			...(name ? { name } : {}),
			...(input.resetTwoFactor ? { resetTwoFactor: true } : {}),
		});
		if (input.resetTwoFactor) {
			await ports.credentials.forgetSecondFactor(personId);
		}
		await ports.credentials.savePassword(personId, input.password);
		return { email };
	};
