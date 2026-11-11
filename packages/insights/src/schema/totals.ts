import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgView, text } from "drizzle-orm/pg-core";

import { usageFact, usageUsefulRun } from "./fact";
import {
	BY_DEADLINE,
	BY_PERSON,
	CLOSED,
	eventIs,
	FINISHED,
	GATE,
	lit,
	MERGED,
	REVERTED,
	RUN,
	VIA_LOCK,
	VIA_PHONE,
	VIA_WEB,
} from "./keys";

/**
 * Runs, their cost, the runs that needed a person, and the useful answers.
 * `reportedNeededYou` counts only the ends of a build that sends the field.
 */
export const usageRunTotals = pgView("usage_run_totals", {
	runs: integer("runs").notNull(),
	finished: integer("finished").notNull(),
	reportedNeededYou: integer("reported_needed_you").notNull(),
	neededYou: integer("needed_you").notNull(),
	costUsd: doublePrecision("cost_usd").notNull(),
	answered: integer("answered").notNull(),
	useful: integer("useful").notNull(),
}).as(sql`
	SELECT
		count(*) FILTER (WHERE ${eventIs(RUN)})::int AS runs,
		count(*) FILTER (WHERE ${eventIs(RUN)} AND run_status = ${lit(FINISHED)})::int AS finished,
		count(*) FILTER (WHERE ${eventIs(RUN)} AND needed_you IS NOT NULL)::int AS reported_needed_you,
		count(*) FILTER (WHERE ${eventIs(RUN)} AND needed_you)::int AS needed_you,
		coalesce(sum(cost_usd) FILTER (WHERE ${eventIs(RUN)}), 0)::double precision AS cost_usd,
		(SELECT count(*) FROM ${usageUsefulRun})::int AS answered,
		(SELECT count(*) FROM ${usageUsefulRun} WHERE useful)::int AS useful
	FROM ${usageFact}
`);

/** What became of the pull requests runs opened: the code scorer's scores. */
export const usagePullRequestTotals = pgView("usage_pull_request_totals", {
	merged: integer("merged").notNull(),
	closed: integer("closed").notNull(),
	revertedWithin7Days: integer("reverted_within_7_days").notNull(),
}).as(sql`
	SELECT
		count(*) FILTER (WHERE score_name = ${lit(MERGED)})::int AS merged,
		count(*) FILTER (WHERE score_name = ${lit(CLOSED)})::int AS closed,
		count(*) FILTER (WHERE score_name = ${lit(REVERTED)})::int AS reverted_within_7_days
	FROM ${usageFact}
`);

/** The same pull request counts for one install in one UTC week. */
export const usagePullRequestWeek = pgView("usage_pull_request_week", {
	installId: text("install_id").notNull(),
	week: text("week").notNull(),
	merged: integer("merged").notNull(),
	closed: integer("closed").notNull(),
	revertedWithin7Days: integer("reverted_within_7_days").notNull(),
}).as(sql`
	SELECT
		install_id,
		to_char(date_trunc('week', event_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
		count(*) FILTER (WHERE score_name = ${lit(MERGED)})::int AS merged,
		count(*) FILTER (WHERE score_name = ${lit(CLOSED)})::int AS closed,
		count(*) FILTER (WHERE score_name = ${lit(REVERTED)})::int AS reverted_within_7_days
	FROM ${usageFact}
	WHERE install_id IS NOT NULL
		AND score_name IN (${lit(MERGED)}, ${lit(CLOSED)}, ${lit(REVERTED)})
	GROUP BY 1, 2
`);

/** Who answered Gates, how long they waited, and where the answer came from. */
export const usageGates = pgView("usage_gates", {
	byPerson: integer("by_person").notNull(),
	byDeadline: integer("by_deadline").notNull(),
	medianWaitSeconds: doublePrecision("median_wait_seconds"),
	phone: integer("phone").notNull(),
	web: integer("web").notNull(),
	lockScreen: integer("lock_screen").notNull(),
	other: integer("other").notNull(),
}).as(sql`
	SELECT
		count(*) FILTER (WHERE gate_by = ${lit(BY_PERSON)})::int AS by_person,
		count(*) FILTER (WHERE gate_by = ${lit(BY_DEADLINE)})::int AS by_deadline,
		(percentile_cont(0.5) WITHIN GROUP (ORDER BY gate_wait))::double precision AS median_wait_seconds,
		count(*) FILTER (WHERE gate_via = ${lit(VIA_PHONE)})::int AS phone,
		count(*) FILTER (WHERE gate_via = ${lit(VIA_WEB)})::int AS web,
		count(*) FILTER (WHERE gate_via = ${lit(VIA_LOCK)})::int AS lock_screen,
		count(*) FILTER (
			WHERE gate_via IS NOT NULL
				AND gate_via <> ${lit(VIA_PHONE)}
				AND gate_via <> ${lit(VIA_WEB)}
				AND gate_via <> ${lit(VIA_LOCK)}
		)::int AS other
	FROM ${usageFact}
	WHERE ${eventIs(GATE)}
`);

/** Installs and days with a run in the current UTC week. */
export const usageThisWeek = pgView("usage_this_week", {
	activeInstalls: integer("active_installs").notNull(),
	daysWithRuns: integer("days_with_runs").notNull(),
}).as(sql`
	SELECT
		count(DISTINCT install_id)::int AS active_installs,
		count(DISTINCT (install_id, (event_time AT TIME ZONE 'UTC')::date)) FILTER (
			WHERE ${eventIs(RUN)}
		)::int AS days_with_runs
	FROM ${usageFact}
	WHERE install_id IS NOT NULL
		AND date_trunc('week', event_time AT TIME ZONE 'UTC')
			= date_trunc('week', (now() AT TIME ZONE 'UTC'))
`);
