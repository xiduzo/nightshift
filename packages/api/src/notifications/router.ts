import {
	notificationSettingsPatchSchema,
	registerTargetSchema,
} from "@nightshift/notifications";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output, stream } from "../output";
import { protectedProcedure, readable } from "../procedures";
import {
	notificationItemSchema,
	pushTargetSchema,
	settingsSchema,
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
				"Streams what happens in every Space you are in: a new Gate, a closed Gate, a finished run, a failed run.",
		})
		.output(stream(notificationItemSchema))
		.handler(async function* ({ context, signal }) {
			const controller = new AbortController();
			signal?.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
			try {
				yield* context.notifications.watch(
					context.session.user.id,
					controller.signal,
				);
			} catch (error) {
				throw readable(error);
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
			.input(registerTargetSchema)
			.handler(({ context, input }) =>
				context.notifications.targets.register(
					context.session.user.id,
					input,
					context.session.session?.id ?? null,
				),
			),
		remove: protectedProcedure
			.route({
				summary: "Removes one of your screens: it gets no more notifications.",
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
						message: "This screen is not in your list.",
					});
				}
			}),
	},
};
