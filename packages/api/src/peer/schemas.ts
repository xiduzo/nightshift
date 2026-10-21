import {
	followWantSchema,
	type RunCommand,
	runRowsSchema,
	type SyncBatch,
	syncCursorsSchema,
} from "@nightshift/devices";

import { z } from "zod";

import { exact } from "../output";

const commandFields = {
	id: z.string(),
	spaceId: z.string(),
	runId: z.string(),
	walkerId: z.string(),
	/** Who asked, on the Host. */
	personId: z.string(),
	createdAt: z.number(),
};

/** A person's action on a run another Device walks, on its way to that Walker. */
const runCommandSchema = exact<RunCommand>()(
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("gate.resolve"),
			payload: z.object({
				stepId: z.string(),
				choice: z.string(),
				note: z.string().optional(),
			}),
			...commandFields,
		}),
		z.object({
			kind: z.literal("signal.send"),
			payload: z.object({ name: z.string() }),
			...commandFields,
		}),
		z.object({
			kind: z.literal("run.stop"),
			payload: z.object({
				when: z.enum(["now", "after-step", "cancel-after-step"]).optional(),
			}),
			...commandFields,
		}),
		z.object({
			kind: z.literal("run.move"),
			payload: z.object({ to: z.string() }),
			...commandFields,
		}),
	]),
);

/** One answer of the exchange: rows after the Device's cursors, and its commands. */
export const syncBatchSchema = exact<SyncBatch>()(
	z.object({
		rows: runRowsSchema,
		/** The cursors moved past these rows. */
		cursors: syncCursorsSchema,
		commands: z.array(runCommandSchema),
		/** The steps someone follows now, with the `seq` to send from. */
		follows: z.array(followWantSchema),
	}),
);
