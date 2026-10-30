import {
	notificationSettingsPatchSchema,
	registerScreenSchema,
} from "@nightshift/notifications";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output, stream } from "../output";
import { protectedProcedure, readable } from "../procedures";
import {
	digestSchema,
	notificationItemSchema,
	pushTargetSchema,
	settingsSchema,
	watchInputSchema,
	webPushKeySchema,
} from "./schemas";

/**
 * The signed-in Person's notifications: the in-app stream across every
 * Space they are in, their settings, and the screens that get pushes.
 * Each is the Person's own: nobody reads or changes another Person's.
 */
export const notifications = {
	watch: protectedProcedure
		.route({
			summary:
				"Streams what happens in every Space you are in: a new Gate, a closed Gate, a finished run, a failed run, a run that changed.",
		})
		.input(watchInputSchema)
		.output(stream(notificationItemSchema))
		.handler(async function* ({ context, input, signal, path }) {
			const controller = new AbortController();
			signal?.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
			try {
				// A page on this computer itself: the desktop notification
				// here waits while it is open.
				yield* context.notifications.watch(
					context.session.user.id,
					controller.signal,
					{ here: context.fromThisComputer, phone: input?.phone === true },
				);
			} catch (error) {
				throw readable(error, path);
			} finally {
				controller.abort();
			}
		}),
	settings: {
		get: protectedProcedure
			.route({
				summary:
					"Reads your notification settings: which events, quiet hours, which screens and the phone delay.",
			})
			.output(output(settingsSchema))
			.handler(({ context }) =>
				context.notifications.settings.get(context.session.user.id),
			),
		save: protectedProcedure
			.route({
				summary:
					"Saves a change of your notification settings and returns them all.",
			})
			.output(output(settingsSchema))
			.input(notificationSettingsPatchSchema)
			.handler(({ context, input }) =>
				context.notifications.settings.save(context.session.user.id, input),
			),
	},
	targets: {
		list: protectedProcedure
			.route({
				summary:
					"Lists the browsers, phones and desktop apps that get your notifications.",
			})
			.output(output(z.array(pushTargetSchema)))
			.handler(({ context }) =>
				context.notifications.targets.list(context.session.user.id),
			),
		register: protectedProcedure
			.route({
				summary:
					"Registers this browser, phone or desktop app to get your notifications.",
			})
			.output(output(pushTargetSchema))
			.input(registerScreenSchema)
			.handler(({ context, input }) =>
				context.notifications.targets.register(
					context.session.user.id,
					input,
					context.session.session?.id ?? null,
				),
			),
		remove: protectedProcedure
			.route({
				summary:
					"Removes one of your screens: it gets no more notifications, and a phone is signed out.",
			})
			.output(output(z.void()))
			.input(z.object({ id: z.string().min(1) }))
			.handler(async ({ context, input }) => {
				const removed = await context.notifications.targets.remove(
					context.session.user.id,
					input.id,
				);
				if (!removed) {
					throw new ORPCError("NOT_FOUND", {
						message:
							"This phone or browser is not in your list. Reload the page to see the list.",
					});
				}
			}),
	},
	digest: {
		latest: protectedProcedure
			.route({
				summary:
					"Reads your last morning digest again: the runs that ended before it, with status, cost and pull request, and the Gates that wait now.",
			})
			.output(output(digestSchema.nullable()))
			.handler(({ context }) =>
				context.notifications.digest.latest(context.session.user.id),
			),
		since: protectedProcedure
			.route({
				summary:
					"Reads a digest now: the runs that ended since a time (default: your last digest), with status, cost and pull request, and the Gates that wait now.",
			})
			.input(
				z
					.object({
						/** Epoch ms. Left out: since your last digest, or a day back. */
						since: z.number().int().min(0).optional(),
					})
					.optional(),
			)
			.output(output(digestSchema.nullable()))
			.handler(({ context, input }) =>
				context.notifications.digest.since(
					context.session.user.id,
					input?.since,
				),
			),
	},
	webPush: {
		key: protectedProcedure
			.route({
				summary:
					"Gives the public key a browser subscribes with to get your notifications while no Night Shift page is open.",
			})
			.output(output(webPushKeySchema))
			.handler(async ({ context }) => ({
				publicKey: await context.notifications.webPush.publicKey(),
			})),
	},
};
