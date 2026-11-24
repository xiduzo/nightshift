import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	doublePrecision,
	pgView,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import {
	ACTIVE,
	FLOW,
	GATE,
	jsonBool,
	jsonNumber,
	jsonText,
	lit,
	RUN,
	SCORED,
	STARTED,
	USEFUL,
} from "./keys";
import { usageEvent } from "./table";

/** Flat columns for the views. Attribute keys stay in this select. */
export const usageFact = pgView("usage_fact", {
	id: bigint("id", { mode: "number" }).notNull(),
	installId: text("install_id"),
	eventName: text("event_name").notNull(),
	eventTime: timestamp("event_time", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	serviceVersion: text("service_version"),
	osType: text("os_type"),
	hostArch: text("host_arch"),
	country: text("country"),
	endReason: text("end_reason"),
	runStatus: text("run_status"),
	costUsd: doublePrecision("cost_usd"),
	neededYou: boolean("needed_you"),
	runId: text("run_id"),
	scoreName: text("score_name"),
	scoreValue: doublePrecision("score_value"),
	scoreHours: doublePrecision("score_hours"),
	gateBy: text("gate_by"),
	gateVia: text("gate_via"),
	gateWait: doublePrecision("gate_wait"),
	agents: doublePrecision("agents"),
	installEntry: text("install_entry"),
	installHost: boolean("install_host"),
	flowFrom: text("flow_from"),
	flowStarter: text("flow_starter"),
}).as(sql`
	SELECT
		id,
		install_id,
		event_name,
		event_time,
		service_version,
		os_type,
		host_arch,
		country,
		${jsonText(RUN, "end_reason")} AS end_reason,
		${jsonText(RUN, "run.status")} AS run_status,
		${jsonNumber(RUN, "cost_usd")} AS cost_usd,
		${jsonBool(RUN, "needed_you")} AS needed_you,
		${jsonText(SCORED, "run.id")} AS run_id,
		${jsonText(SCORED, "score.name")} AS score_name,
		${jsonNumber(SCORED, "score.value")} AS score_value,
		${jsonNumber(SCORED, "score.hours")} AS score_hours,
		${jsonText(GATE, "gate.by")} AS gate_by,
		${jsonText(GATE, "gate.via")} AS gate_via,
		${jsonNumber(GATE, "gate.wait")} AS gate_wait,
		${jsonNumber(ACTIVE, "install.agents")} AS agents,
		${jsonText(STARTED, "install.entry")} AS install_entry,
		${jsonBool(STARTED, "install.host")} AS install_host,
		${jsonText(FLOW, "flow.from")} AS flow_from,
		${jsonText(FLOW, "flow.starter")} AS flow_starter
	FROM ${usageEvent}
`);

/**
 * The latest useful answer of each run. A person can change an answer.
 */
export const usageUsefulRun = pgView("usage_useful_run", {
	installId: text("install_id").notNull(),
	runId: text("run_id").notNull(),
	answeredAt: timestamp("answered_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	useful: boolean("useful").notNull(),
}).as(sql`
	SELECT DISTINCT ON (install_id, run_id)
		install_id,
		run_id,
		event_time AS answered_at,
		score_value > 0 AS useful
	FROM ${usageFact}
	WHERE score_name = ${lit(USEFUL)}
		AND install_id IS NOT NULL
		AND run_id IS NOT NULL
		AND score_value IS NOT NULL
	ORDER BY install_id, run_id, event_time DESC, id DESC
`);

/**
 * An install with one day of events more than ten times the median day.
 * The admin UI marks these. Empty when no day is that far out.
 */
export const usageFlaggedInstall = pgView("usage_flagged_install", {
	installId: text("install_id").notNull(),
}).as(sql`
	WITH daily AS (
		SELECT
			install_id,
			(event_time AT TIME ZONE 'UTC')::date AS day,
			count(*)::double precision AS n
		FROM ${usageEvent}
		WHERE install_id IS NOT NULL
		GROUP BY 1, 2
	),
	med AS (
		SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n) AS median_daily
		FROM daily
	)
	SELECT d.install_id
	FROM daily d
	CROSS JOIN med
	WHERE med.median_daily > 0 AND d.n > med.median_daily * 10
	GROUP BY d.install_id
`);
