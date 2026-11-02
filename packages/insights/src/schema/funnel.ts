import { type SQL, sql } from "drizzle-orm";
import {
	doublePrecision,
	integer,
	pgView,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { usageFact } from "./fact";
import {
	AGENT,
	CHECKED,
	eventIs,
	FINISHED,
	FLOW,
	ident,
	lit,
	MERGED,
	OPENED,
	OUTCOME,
	PROJECT,
	RUN,
	SCHEDULE,
	STARTED,
} from "./keys";

const STEPS = [
	{ id: "install", column: "step_install", previous: null },
	{ id: "agent", column: "step_agent", previous: "step_install" },
	{ id: "project", column: "step_project", previous: "step_agent" },
	{ id: "checked", column: "step_checked", previous: "step_project" },
	{ id: "flow", column: "step_flow", previous: "step_checked" },
	{ id: "schedule", column: "step_schedule", previous: "step_flow" },
	{ id: "run", column: "step_run", previous: "step_schedule" },
	{ id: "finished", column: "step_finished", previous: "step_run" },
	{
		id: "pull_request",
		column: "step_pull_request",
		previous: "step_finished",
	},
	{ id: "merged", column: "step_merged", previous: "step_pull_request" },
] as const;

function consecutive(): SQL {
	const arms = STEPS.map(
		(step, index) =>
			sql`WHEN ${ident(step.column)} IS NULL THEN ${sql.raw(String(index))}`,
	);
	return sql`CASE ${sql.join(arms, sql` `)} ELSE ${sql.raw(String(STEPS.length))} END`;
}

/** First time each install reached a funnel step, and how far the steps run without a gap. */
export const usageFunnelInstall = pgView("usage_funnel_install", {
	installId: text("install_id").notNull(),
	stepInstall: timestamp("step_install", { withTimezone: true, mode: "date" }),
	stepAgent: timestamp("step_agent", { withTimezone: true, mode: "date" }),
	stepProject: timestamp("step_project", { withTimezone: true, mode: "date" }),
	stepChecked: timestamp("step_checked", { withTimezone: true, mode: "date" }),
	stepFlow: timestamp("step_flow", { withTimezone: true, mode: "date" }),
	stepSchedule: timestamp("step_schedule", {
		withTimezone: true,
		mode: "date",
	}),
	stepRun: timestamp("step_run", { withTimezone: true, mode: "date" }),
	stepFinished: timestamp("step_finished", {
		withTimezone: true,
		mode: "date",
	}),
	stepPullRequest: timestamp("step_pull_request", {
		withTimezone: true,
		mode: "date",
	}),
	stepMerged: timestamp("step_merged", { withTimezone: true, mode: "date" }),
	consecutive: integer("consecutive").notNull(),
}).as(sql`
	SELECT
		install_id,
		step_install,
		step_agent,
		step_project,
		step_checked,
		step_flow,
		step_schedule,
		step_run,
		step_finished,
		step_pull_request,
		step_merged,
		${consecutive()} AS consecutive
	FROM (
		SELECT
			install_id,
			min(event_time) FILTER (WHERE ${eventIs(STARTED)}) AS step_install,
			min(event_time) FILTER (WHERE ${eventIs(AGENT)}) AS step_agent,
			min(event_time) FILTER (WHERE ${eventIs(PROJECT)}) AS step_project,
			min(event_time) FILTER (WHERE ${eventIs(CHECKED)}) AS step_checked,
			min(event_time) FILTER (WHERE ${eventIs(FLOW)}) AS step_flow,
			min(event_time) FILTER (WHERE ${eventIs(SCHEDULE)}) AS step_schedule,
			min(event_time) FILTER (WHERE ${eventIs(RUN)}) AS step_run,
			min(event_time) FILTER (WHERE ${eventIs(RUN)} AND run_status = ${lit(FINISHED)}) AS step_finished,
			min(event_time) FILTER (WHERE ${eventIs(OPENED)}) AS step_pull_request,
			min(event_time) FILTER (WHERE ${eventIs(OUTCOME)} AND pr_outcome = ${lit(MERGED)}) AS step_merged
		FROM ${usageFact}
		WHERE install_id IS NOT NULL
		GROUP BY install_id
	) steps
`);

function stepBranch(step: (typeof STEPS)[number], ord: number): SQL {
	const column = ident(step.column);
	const ordSql = sql.raw(String(ord));
	const last = sql.raw(String(STEPS.length));
	const fromInstall =
		step.column === "step_install"
			? sql`NULL::double precision`
			: sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (${column} - step_install))) FILTER (WHERE consecutive >= ${ordSql} AND step_install IS NOT NULL AND ${column} IS NOT NULL))::double precision`;
	const fromPrevious = step.previous
		? sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (${column} - ${ident(step.previous)}))) FILTER (WHERE consecutive >= ${ordSql} AND ${ident(step.previous)} IS NOT NULL AND ${column} IS NOT NULL))::double precision`
		: sql`NULL::double precision`;
	return sql`
		SELECT
			${lit(step.id)} AS step,
			${ordSql}::int AS step_order,
			count(*) FILTER (WHERE consecutive >= ${ordSql})::int AS installs,
			count(*) FILTER (WHERE consecutive = ${ordSql} AND ${ordSql} < ${last})::int AS stopped,
			${fromInstall} AS median_seconds_from_install,
			${fromPrevious} AS median_seconds_from_previous
		FROM ${usageFunnelInstall}
	`;
}

/** Where installs stop, and the median time between the steps they did reach. */
export const usageFunnelStep = pgView("usage_funnel_step", {
	step: text("step").notNull(),
	stepOrder: integer("step_order").notNull(),
	installs: integer("installs").notNull(),
	stopped: integer("stopped").notNull(),
	medianSecondsFromInstall: doublePrecision("median_seconds_from_install"),
	medianSecondsFromPrevious: doublePrecision("median_seconds_from_previous"),
}).as(
	sql.join(
		STEPS.map((step, index) => stepBranch(step, index + 1)),
		sql` UNION ALL `,
	),
);

/**
 * Median time from install to the first finished run, and to the first
 * merged pull request. A skipped setup step still counts.
 */
export const usageTimeToFirst = pgView("usage_time_to_first", {
	medianSecondsToFinished: doublePrecision("median_seconds_to_finished"),
	medianSecondsToMerged: doublePrecision("median_seconds_to_merged"),
}).as(sql`
	SELECT
		(percentile_cont(0.5) WITHIN GROUP (
			ORDER BY extract(epoch FROM (step_finished - step_install))
		) FILTER (
			WHERE step_install IS NOT NULL
				AND step_finished IS NOT NULL
				AND step_finished >= step_install
		))::double precision AS median_seconds_to_finished,
		(percentile_cont(0.5) WITHIN GROUP (
			ORDER BY extract(epoch FROM (step_merged - step_install))
		) FILTER (
			WHERE step_install IS NOT NULL
				AND step_merged IS NOT NULL
				AND step_merged >= step_install
		))::double precision AS median_seconds_to_merged
	FROM ${usageFunnelInstall}
`);
