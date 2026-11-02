import { sql } from "drizzle-orm";
import {
	boolean,
	doublePrecision,
	integer,
	pgView,
	text,
} from "drizzle-orm/pg-core";

import { usageFact } from "./fact";
import { eventIs, RUN } from "./keys";

/** Shared week rows. Each view reads `usage_fact` on its own. */
const weekSelect = sql`
	SELECT
		to_char(date_trunc('week', event_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
		count(DISTINCT install_id)::int AS active_installs,
		count(DISTINCT install_id) FILTER (WHERE ${eventIs(RUN)})::int AS installs_with_runs,
		count(DISTINCT (install_id, (event_time AT TIME ZONE 'UTC')::date)) FILTER (
			WHERE ${eventIs(RUN)}
		)::int AS nights
	FROM ${usageFact}
	WHERE install_id IS NOT NULL
	GROUP BY 1
`;

/** One UTC week: installs that sent anything, installs that ran, and run-nights. */
export const usageWeek = pgView("usage_week", {
	week: text("week").notNull(),
	activeInstalls: integer("active_installs").notNull(),
	installsWithRuns: integer("installs_with_runs").notNull(),
	nights: integer("nights").notNull(),
}).as(weekSelect);

/**
 * Mean run-nights per install, across weeks that had a run.
 * Null when no week had a run.
 */
export const usageNightsPerWeek = pgView("usage_nights_per_week", {
	nightsPerWeek: doublePrecision("nights_per_week"),
}).as(sql`
	SELECT avg(nights::double precision / installs_with_runs) AS nights_per_week
	FROM (${weekSelect}) weeks
	WHERE installs_with_runs > 0
`);

/**
 * Weekly cohorts by the week of the first run.
 * `mature` is true once week 4 of that cohort is over.
 */
export const usageCohort = pgView("usage_cohort", {
	week: text("week").notNull(),
	size: integer("size").notNull(),
	retainedWeek4: integer("retained_week_4").notNull(),
	mature: boolean("mature").notNull(),
}).as(sql`
	WITH first_run AS (
		SELECT
			install_id,
			date_trunc('week', min(event_time) AT TIME ZONE 'UTC') AS cohort
		FROM ${usageFact}
		WHERE ${eventIs(RUN)} AND install_id IS NOT NULL
		GROUP BY install_id
	),
	runs AS (
		SELECT DISTINCT
			install_id,
			date_trunc('week', event_time AT TIME ZONE 'UTC') AS week
		FROM ${usageFact}
		WHERE ${eventIs(RUN)} AND install_id IS NOT NULL
	)
	SELECT
		to_char(first_run.cohort, 'YYYY-MM-DD') AS week,
		count(*)::int AS size,
		count(*) FILTER (
			WHERE EXISTS (
				SELECT 1
				FROM runs
				WHERE runs.install_id = first_run.install_id
					AND runs.week = first_run.cohort + interval '4 weeks'
			)
		)::int AS retained_week_4,
		bool_or(
			first_run.cohort + interval '4 weeks'
				<= date_trunc('week', (now() AT TIME ZONE 'UTC'))
		) AS mature
	FROM first_run
	GROUP BY first_run.cohort
`);
