import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgView, text } from "drizzle-orm/pg-core";

import {
	BY_RULE,
	CHOICE,
	eventIs,
	jsonBool,
	jsonNumber,
	jsonText,
	lit,
	members,
	STEP,
	WORK,
} from "./keys";
import { usageEvent } from "./table";

/** The work ladder and the choice ladder, as the registry names them. */
export const LADDER_KIND = { work: WORK, choice: CHOICE } as const;

/** Every rung, in the registry's order: rule, first, later, person, deadline, none. */
export const LADDER_RUNGS = members(STEP, "ladder.rung");

/**
 * Where the work landed (Q31), per ladder and rung. It reads the step ends
 * that carry a rung: a newer build sends one on the step a climb landed
 * on. Older step ends have none and do not count. It reads `usage_event`
 * itself, so `usage_fact` keeps its columns.
 *
 * A row whose `rung` is null holds the whole ladder.
 *
 * - `costed` and `cost_usd`: the landings whose cost is known, and that
 *   cost. A build leaves the cost out when part of it is unknown.
 * - `decided`: the Decisions that say whether a decider was not sure
 *   enough, except those a rule made. A Decision by a model that has no
 *   cascade, or a climb from a rule to a person, counts too: a step end
 *   does not say whether a decider picked.
 * - `unsure`: the Decisions where a decider was not sure enough.
 */
export const usageLadder = pgView("usage_ladder", {
	kind: text("kind").notNull(),
	rung: text("rung"),
	landings: integer("landings").notNull(),
	installs: integer("installs").notNull(),
	costed: integer("costed").notNull(),
	costUsd: doublePrecision("cost_usd").notNull(),
	decided: integer("decided").notNull(),
	unsure: integer("unsure").notNull(),
}).as(sql`
	WITH landed AS (
		SELECT
			install_id,
			${jsonText(STEP, "ladder.kind")} AS kind,
			${jsonText(STEP, "ladder.rung")} AS rung,
			${jsonNumber(STEP, "ladder.cost_usd")} AS cost_usd,
			${jsonBool(STEP, "ladder.unsure")} AS unsure
		FROM ${usageEvent}
		WHERE ${eventIs(STEP)}
	)
	SELECT
		kind,
		rung,
		count(*)::int AS landings,
		count(DISTINCT install_id)::int AS installs,
		count(cost_usd)::int AS costed,
		coalesce(sum(cost_usd), 0)::double precision AS cost_usd,
		count(*) FILTER (
			WHERE kind = ${lit(CHOICE)} AND rung <> ${lit(BY_RULE)} AND unsure IS NOT NULL
		)::int AS decided,
		count(*) FILTER (WHERE kind = ${lit(CHOICE)} AND unsure)::int AS unsure
	FROM landed
	WHERE kind IS NOT NULL AND rung IS NOT NULL
	GROUP BY GROUPING SETS ((kind, rung), (kind))
`);
