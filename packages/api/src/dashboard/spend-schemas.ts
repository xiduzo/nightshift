import {
	COST_STEADINESS,
	HELP_AGENTS,
	SAVING_KINDS,
	type SpaceSpend,
} from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import { nightRangeSchema, spreadSchema } from "./measure-schemas";

/**
 * The Spend page: what the runs of a Space cost. The output mirrors the
 * engine's type exactly (`exact`).
 */

const spendStepRefSchema = z.object({
	nodeId: z.string(),
	/** The Subflow nodes it ran in, joined by `/`. Absent at the top level. */
	via: z.string().optional(),
});

/** What the runs of a Space cost, how steady that is, and where a change saves. */
export const spaceSpendSchema = exact<SpaceSpend>()(
	z.object({
		at: z.number(),
		ranges: z.array(
			z.object({
				nights: nightRangeSchema,
				total: z.number(),
				before: z.number(),
				runs: z.number(),
				unknown: z.number(),
				perNight: z.array(
					z.object({
						night: z.number(),
						costUsd: z.number(),
						saves: z.number(),
					}),
				),
				flows: z.array(
					z.object({
						key: z.string(),
						projectId: z.string(),
						flow: z.string(),
						runs: z.number(),
						spent: z.number(),
						usual: spreadSchema.nullable(),
						steadiness: z.enum(COST_STEADINESS).nullable(),
						saves: z.number(),
						steps: z.array(
							spendStepRefSchema.extend({
								key: z.string(),
								perRun: z.number(),
								most: z.number(),
								timesPerRun: z.number(),
							}),
						),
					}),
				),
				quick: z.object({ runs: z.number(), spent: z.number() }),
				savings: z.array(
					z.object({
						key: z.string(),
						kind: z.enum(SAVING_KINDS),
						projectId: z.string(),
						flow: z.string(),
						saves: z.number(),
						runs: z.number(),
						of: z.number(),
						runId: z.string(),
						step: spendStepRefSchema.optional(),
					}),
				),
				saves: z.number(),
				// What Night Shift's own agents cost. Not part of a run's cost.
				help: z.object({
					total: z.number(),
					answers: z.number(),
					unknown: z.number(),
					agents: z.array(
						z.object({
							agent: z.enum(HELP_AGENTS),
							answers: z.number(),
							costUsd: z.number(),
						}),
					),
				}),
			}),
		),
		helpThisMonth: z.number(),
	}),
);
