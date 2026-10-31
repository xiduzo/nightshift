import {
	type Digest,
	type DigestGate,
	type DigestKnowledgeSource,
	type DigestRun,
	type InAppItem,
	type NotificationSettings,
	notificationSettingsSchema,
	type PushTargetView,
	pushKindSchema,
} from "@nightshift/notifications";
import { z } from "zod";

import { exact } from "../output";
import { runStatusSchema } from "../runs";

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

const noticeKindSchema = z.enum([
	"gate-opened",
	"run-finished",
	"run-failed",
	"device-wait",
]);

/** One item of the in-app stream: what happened in a Space, with ids and one short sentence. */
export const notificationItemSchema = exact<InAppItem>()(
	z.discriminatedUnion("kind", [
		z.object({
			kind: noticeKindSchema,
			/**
			 * `runId:stepId` for a Gate, `runId:end:<seq>` for a run that
			 * ended, `runId:wait:<stepId>` for a step that waits for a Device.
			 */
			key: z.string(),
			spaceId: z.string(),
			runId: z.string(),
			/** The Gate's step, or the step that waits. Null for a run. */
			stepId: z.string().nullable(),
			title: z.string(),
			/** The second line of a device wait: when the run stops waiting. */
			body: z.string().optional(),
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
		/** A step no longer waits for its Device. An older screen reads everything again. */
		z.object({
			kind: z.literal("wait-ended"),
			key: z.string(),
			runId: z.string(),
			stepId: z.string(),
			at: z.number(),
		}),
		/**
		 * A run started, slept or woke, moved, stopped or ended, or a step
		 * started or ended. No key and no `alert`: an older screen reads
		 * everything again and shows nothing.
		 */
		z.object({
			kind: z.literal("run-changed"),
			spaceId: z.string(),
			runId: z.string(),
			at: z.number(),
		}),
	]),
);

const digestRunSchema = exact<DigestRun>()(
	z.object({
		runId: z.string(),
		spaceId: z.string(),
		/** The flow and the run's inputs, or "Quick run · <prompt>". */
		title: z.string(),
		status: runStatusSchema,
		/** "Finished", "Nothing to do", "Failed", "Stopped". */
		statusText: z.string(),
		/** The cost with how sure it is, why it ended, what went wrong. */
		detail: z.string().nullable(),
		prUrl: z.string().nullable(),
		endedAt: z.number(),
	}),
);

const digestGateSchema = exact<DigestGate>()(
	z.object({
		spaceId: z.string(),
		runId: z.string(),
		stepId: z.string(),
		title: z.string(),
	}),
);

const digestKnowledgeSourceSchema = exact<DigestKnowledgeSource>()(
	z.object({
		spaceId: z.string(),
		projectId: z.string(),
		/** The source and its project. */
		title: z.string(),
		/** "Last sync failed", "Not synced in a week". */
		statusText: z.string(),
		/** Its last run. */
		runId: z.string(),
	}),
);

/** The last morning digest: the runs that ended before it, the Gates that wait now, and the knowledge sources that need you. */
export const digestSchema = exact<Digest>()(
	z.object({
		from: z.number(),
		to: z.number(),
		title: z.string(),
		body: z.string(),
		runs: z.array(digestRunSchema),
		gates: z.array(digestGateSchema),
		sources: z.array(digestKnowledgeSourceSchema),
	}),
);

/** Who follows the stream. Optional, so an older screen sends nothing. */
export const watchInputSchema = z
	.object({
		/** The phone app: it counts as closed once it leaves the front. */
		phone: z.boolean().optional(),
	})
	.optional();

/** The public VAPID key of this Night Shift. Null: it sends no browser notifications. */
export const webPushKeySchema = z.object({
	/** URL-safe base64, as `PushManager.subscribe` takes it. */
	publicKey: z.string().nullable(),
});
