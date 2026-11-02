import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgView, text } from "drizzle-orm/pg-core";

import { usageFact } from "./fact";
import {
	BY_DEADLINE,
	BY_PERSON,
	CLOSED,
	eventIs,
	GATE,
	lit,
	MERGED,
	OPENED,
	OUTCOME,
	REVERTED,
	REWORK_HOURS,
	RUN,
	VIA_LOCK,
	VIA_PHONE,
	VIA_WEB,
} from "./keys";

/** Opened, merged, closed, reverted, rework within 7 days, and the cost of runs. */
export const usagePullRequestTotals = pgView("usage_pull_request_totals", {
	opened: integer("opened").notNull(),
	merged: integer("merged").notNull(),
	closed: integer("closed").notNull(),
	reverted: integer("reverted").notNull(),
	revertedWithin7Days: integer("reverted_within_7_days").notNull(),
	costUsd: doublePrecision("cost_usd").notNull(),
}).as(sql`
	SELECT
		count(*) FILTER (WHERE ${eventIs(OPENED)})::int AS opened,
		count(*) FILTER (WHERE ${eventIs(OUTCOME)} AND pr_outcome = ${lit(MERGED)})::int AS merged,
		count(*) FILTER (WHERE ${eventIs(OUTCOME)} AND pr_outcome = ${lit(CLOSED)})::int AS closed,
		count(*) FILTER (WHERE ${eventIs(OUTCOME)} AND pr_outcome = ${lit(REVERTED)})::int AS reverted,
		count(*) FILTER (
			WHERE ${eventIs(OUTCOME)}
				AND pr_outcome = ${lit(REVERTED)}
				AND pr_hours <= ${sql.raw(String(REWORK_HOURS))}
		)::int AS reverted_within_7_days,
		coalesce(sum(cost_usd) FILTER (WHERE ${eventIs(RUN)}), 0)::double precision AS cost_usd
	FROM ${usageFact}
`);

/** The same pull-request counts for one install in one UTC week. */
export const usagePullRequestWeek = pgView("usage_pull_request_week", {
	installId: text("install_id").notNull(),
	week: text("week").notNull(),
	opened: integer("opened").notNull(),
	merged: integer("merged").notNull(),
	closed: integer("closed").notNull(),
	reverted: integer("reverted").notNull(),
}).as(sql`
	SELECT
		install_id,
		to_char(date_trunc('week', event_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
		count(*) FILTER (WHERE ${eventIs(OPENED)})::int AS opened,
		count(*) FILTER (WHERE ${eventIs(OUTCOME)} AND pr_outcome = ${lit(MERGED)})::int AS merged,
		count(*) FILTER (WHERE ${eventIs(OUTCOME)} AND pr_outcome = ${lit(CLOSED)})::int AS closed,
		count(*) FILTER (WHERE ${eventIs(OUTCOME)} AND pr_outcome = ${lit(REVERTED)})::int AS reverted
	FROM ${usageFact}
	WHERE install_id IS NOT NULL AND (${eventIs(OPENED)} OR ${eventIs(OUTCOME)})
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

/** Installs and run-nights in the current UTC week. */
export const usageThisWeek = pgView("usage_this_week", {
	activeInstalls: integer("active_installs").notNull(),
	nightsWithRuns: integer("nights_with_runs").notNull(),
}).as(sql`
	SELECT
		count(DISTINCT install_id)::int AS active_installs,
		count(DISTINCT (install_id, (event_time AT TIME ZONE 'UTC')::date)) FILTER (
			WHERE ${eventIs(RUN)}
		)::int AS nights_with_runs
	FROM ${usageFact}
	WHERE install_id IS NOT NULL
		AND date_trunc('week', event_time AT TIME ZONE 'UTC')
			= date_trunc('week', (now() AT TIME ZONE 'UTC'))
`);
