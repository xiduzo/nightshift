import { hasLogin, TRUSTED_BROWSER_DAYS } from "@nightshift/auth";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure, publicProcedure } from "../procedures";
import { accountStatusSchema } from "./schemas";

/**
 * The owner's own sign-in, set on this computer: a Host without a screen
 * has a Host admin who signs in for nothing there, and needs an email and a
 * password to sign in from a browser elsewhere (`nightshift admin`).
 */
export const account = {
	/**
	 * How the session's Person signs in, for the account page and the
	 * two-factor setup page. Public: a session the Host refuses until it
	 * turns two-factor on reads it to know where to go.
	 */
	status: publicProcedure
		.route({
			summary:
				"Says how the session's Person signs in, and whether two-factor sign-in is needed.",
		})
		.output(output(accountStatusSchema))
		.handler(async ({ context }) => {
			const session = context.access.session;
			const required = context.requireTwoFactor && !context.fromThisComputer;
			if (!session) {
				return {
					signedIn: false,
					person: null,
					thisComputer: context.fromThisComputer,
					hasPassword: false,
					twoFactor: {
						enabled: false,
						required,
						setUpNeeded: false,
						trustedBrowserDays: TRUSTED_BROWSER_DAYS,
					},
				};
			}
			return {
				signedIn: true,
				person: { name: session.user.name, email: session.user.email },
				thisComputer: context.fromThisComputer,
				hasPassword: await hasLogin(context.db, session.user.id),
				twoFactor: {
					enabled: session.user.twoFactorEnabled === true,
					required,
					setUpNeeded: !context.access.hostAccess.allowed,
					trustedBrowserDays: TRUSTED_BROWSER_DAYS,
				},
			};
		}),
	setLogin: ownerProcedure
		.route({
			summary:
				"Sets the email and password of this computer's owner, on this computer only.",
		})
		.output(output(z.object({ email: z.string() })))
		.input(
			z.object({
				email: z.string().trim().min(3).max(254),
				password: z.string().min(1).max(256),
				name: z.string().trim().max(64).optional(),
				resetTwoFactor: z.boolean().optional(),
			}),
		)
		.handler(({ context, input }) => {
			if (!context.fromThisComputer) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Set the sign-in of this computer's owner on the computer itself.",
				});
			}
			return context.setLogin(context.session.user.id, input);
		}),
};
