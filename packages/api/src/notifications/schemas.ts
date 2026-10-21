import {
	type InAppItem,
	type NotificationSettings,
	notificationSettingsSchema,
	type PushTargetView,
	pushKindSchema,
} from "@nightshift/notifications";
import { z } from "zod";

import { exact } from "../output";

/** A Person's notification settings: which events, quiet hours, which screens, the phone delay. */
export const settingsSchema = exact<NotificationSettings>()(
	notificationSettingsSchema,
);

/** A screen that gets pushes, as its Person sees it in Settings. */
export const pushTargetSchema = exact<PushTargetView>()(
	z.object({
		id: z.string(),
		kind: pushKindSchema,
		name: z.string(),
		platform: z.string(),
		createdAt: z.number(),
		lastSeenAt: z.number().nullable(),
	}),
);

const noticeKindSchema = z.enum(["gate-opened", "run-finished", "run-failed"]);

/** One item of the in-app stream: what happened in a Space, with ids and one short sentence. */
export const notificationItemSchema = exact<InAppItem>()(
	z.discriminatedUnion("kind", [
		z.object({
			kind: noticeKindSchema,
			/** `runId:stepId` for a Gate, `runId:end:<seq>` for a run that ended. */
			key: z.string(),
			spaceId: z.string(),
			runId: z.string(),
			/** The Gate's step. Null for a run. */
			stepId: z.string().nullable(),
			title: z.string(),
			/** Show it as a notification. False: only update what the screen shows. */
			alert: z.boolean(),
			at: z.number(),
		}),
		z.object({
			kind: z.literal("gate-closed"),
			key: z.string(),
			runId: z.string(),
			stepId: z.string(),
			at: z.number(),
		}),
	]),
);

/** The public VAPID key of this Night Shift. Null: it sends no browser notifications. */
export const webPushKeySchema = z.object({
	/** URL-safe base64, as `PushManager.subscribe` takes it. */
	publicKey: z.string().nullable(),
});
