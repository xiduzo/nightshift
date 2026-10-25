import type { Database } from "@nightshift/db";
import { account, session } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { and, eq, gt, inArray } from "drizzle-orm";

import type { Auth } from "../auth";

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
		throw new Refusal("invalid", `${input.email} is not an email address.`);
	}
	if (input.password.length < MIN_PASSWORD_LENGTH) {
		throw new Refusal(
			"invalid",
			`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
		);
	}
	const ctx = await auth.$context;
	const other = await ctx.internalAdapter.findUserByEmail(email);
	if (other && other.user.id !== personId) {
		throw new Refusal(
			"conflict",
			`Another Person here signs in with ${email}.`,
		);
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

/**
 * Ends one of the Person's sessions: the screen that holds it is signed
 * out at its next call. Removing a phone ends the session it signed in
 * with. False when the Person has no session of that id.
 */
export async function endSession(
	db: Database,
	personId: string,
	sessionId: string,
): Promise<boolean> {
	const ended = await db
		.delete(session)
		.where(and(eq(session.id, sessionId), eq(session.userId, personId)))
		.returning({ id: session.id });
	return ended.length > 0;
}

/**
 * Which of these sessions still work: the session exists and has not
 * expired. A phone's push target lives as long as its session.
 */
export async function liveSessionIds(
	db: Database,
	sessionIds: readonly string[],
	now: number = Date.now(),
): Promise<Set<string>> {
	if (sessionIds.length === 0) return new Set();
	const rows = await db
		.select({ id: session.id })
		.from(session)
		.where(
			and(
				inArray(session.id, [...sessionIds]),
				gt(session.expiresAt, new Date(now)),
			),
		);
	return new Set(rows.map((row) => row.id));
}
