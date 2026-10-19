import type { Database } from "@nightshift/db";
import { account } from "@nightshift/db/schema/auth";
import { and, eq } from "drizzle-orm";

import type { Auth } from "./index";

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

/** Whether the Person can sign in with an email and a password. */
export async function hasLogin(
	db: Database,
	personId: string,
): Promise<boolean> {
	const [found] = await db
		.select({ id: account.id })
		.from(account)
		.where(
			and(eq(account.userId, personId), eq(account.providerId, "credential")),
		);
	return found !== undefined;
}

/** Sets the Person's email (and name), and their password: a new one, or in place of the old. */
export async function setLogin(
	auth: Auth,
	personId: string,
	input: LoginInput,
): Promise<{ email: string }> {
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error(`${input.email} is not an email address.`);
	}
	if (input.password.length < MIN_PASSWORD_LENGTH) {
		throw new Error(
			`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
		);
	}
	const ctx = await auth.$context;
	const other = await ctx.internalAdapter.findUserByEmail(email);
	if (other && other.user.id !== personId) {
		throw new Error(`Another Person here signs in with ${email}.`);
	}
	await ctx.internalAdapter.updateUser(personId, {
		email,
		emailVerified: true,
		...(input.name?.trim() ? { name: input.name.trim() } : {}),
		...(input.resetTwoFactor ? { twoFactorEnabled: false } : {}),
	});
	if (input.resetTwoFactor) {
		await ctx.adapter.deleteMany({
			model: "twoFactor",
			where: [{ field: "userId", value: personId }],
		});
	}
	const hash = await ctx.password.hash(input.password);
	const accounts = await ctx.internalAdapter.findAccounts(personId);
	if (accounts.some((a) => a.providerId === "credential")) {
		await ctx.internalAdapter.updatePassword(personId, hash);
	} else {
		await ctx.internalAdapter.linkAccount({
			userId: personId,
			providerId: "credential",
			accountId: personId,
			password: hash,
		});
	}
	return { email };
}
