import type { Database } from "@nightshift/db";
import { account } from "@nightshift/db/schema";
import { and, eq } from "drizzle-orm";
import type { Auth } from "../../../auth";
import type { Credentials } from "../../application/ports";

/**
 * `Credentials` over Better Auth: its internal adapter keeps the Person,
 * the second factor and the password account. Whether a Person has a
 * password is one read of the `account` table. `wireLogin` builds it.
 */
export function betterAuthCredentials(auth: Auth, db: Database): Credentials {
	return {
		async hasPassword(personId) {
			const [found] = await db
				.select({ id: account.id })
				.from(account)
				.where(
					and(
						eq(account.userId, personId),
						eq(account.providerId, "credential"),
					),
				);
			return found !== undefined;
		},
		async personOf(email) {
			const ctx = await auth.$context;
			const found = await ctx.internalAdapter.findUserByEmail(email);
			return found?.user.id ?? null;
		},
		async updatePerson(personId, change) {
			const ctx = await auth.$context;
			await ctx.internalAdapter.updateUser(personId, {
				email: change.email,
				emailVerified: true,
				...(change.name ? { name: change.name } : {}),
				...(change.resetTwoFactor ? { twoFactorEnabled: false } : {}),
			});
		},
		async forgetSecondFactor(personId) {
			const ctx = await auth.$context;
			await ctx.adapter.deleteMany({
				model: "twoFactor",
				where: [{ field: "userId", value: personId }],
			});
		},
		async savePassword(personId, password) {
			const ctx = await auth.$context;
			const hash = await ctx.password.hash(password);
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
		},
	};
}
