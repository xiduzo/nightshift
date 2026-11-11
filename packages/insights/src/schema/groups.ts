import { type SQL, sql } from "drizzle-orm";
import {
	boolean,
	doublePrecision,
	integer,
	pgView,
	text,
} from "drizzle-orm/pg-core";

import { usageFact } from "./fact";
import {
	ACTIVE,
	eventIs,
	FLOW,
	ident,
	lit,
	members,
	RUN,
	STARTED,
} from "./keys";

function grouped(
	column: string,
	alias: string,
	where: SQL,
	order: "ASC" | "DESC",
): SQL {
	const name = ident(alias);
	const source = ident(column);
	const direction = sql.raw(order === "ASC" ? "ASC" : "DESC");
	return sql`
		SELECT ${name}, count(*)::int AS installs
		FROM (
			SELECT DISTINCT ON (install_id) install_id, ${source} AS ${name}
			FROM ${usageFact}
			WHERE install_id IS NOT NULL AND ${source} IS NOT NULL AND (${where})
			ORDER BY install_id, event_time ${direction}
		) picked
		GROUP BY 1
	`;
}

/** How many agents an install reported, at the highest count. */
export const usageAgentCount = pgView("usage_agent_count", {
	agents: integer("agents").notNull(),
	installs: integer("installs").notNull(),
}).as(sql`
	SELECT agents::int AS agents, count(*)::int AS installs
	FROM (
		SELECT install_id, max(agents) AS agents
		FROM ${usageFact}
		WHERE ${eventIs(ACTIVE)} AND agents IS NOT NULL AND install_id IS NOT NULL
		GROUP BY install_id
	) per_install
	GROUP BY 1
`);

/** All installs, and the share whose highest agent count is two or more. */
export const usageAgentShare = pgView("usage_agent_share", {
	installs: integer("installs").notNull(),
	withTwoOrMore: integer("with_two_or_more").notNull(),
	share: doublePrecision("share"),
}).as(sql`
	WITH installs AS (
		SELECT count(DISTINCT install_id)::int AS total
		FROM ${usageFact}
		WHERE install_id IS NOT NULL
	),
	multi AS (
		SELECT count(*)::int AS n
		FROM (
			SELECT install_id
			FROM ${usageFact}
			WHERE ${eventIs(ACTIVE)} AND agents IS NOT NULL AND install_id IS NOT NULL
			GROUP BY install_id
			HAVING max(agents) >= 2
		) per_install
	)
	SELECT
		installs.total AS installs,
		multi.n AS with_two_or_more,
		CASE
			WHEN installs.total = 0 THEN NULL
			ELSE multi.n::double precision / installs.total
		END AS share
	FROM installs
	CROSS JOIN multi
`);

/** Latest operating system of each install. */
export const usageOs = pgView("usage_os", {
	os: text("os").notNull(),
	installs: integer("installs").notNull(),
}).as(grouped("os_type", "os", sql`TRUE`, "DESC"));

/** Latest architecture of each install. */
export const usageArch = pgView("usage_arch", {
	arch: text("arch").notNull(),
	installs: integer("installs").notNull(),
}).as(grouped("host_arch", "arch", sql`TRUE`, "DESC"));

/** Latest version of each install. */
export const usageVersion = pgView("usage_version", {
	version: text("version").notNull(),
	installs: integer("installs").notNull(),
}).as(grouped("service_version", "version", sql`TRUE`, "DESC"));

/** How the install started: desktop, server, or another entry. The first event wins. */
export const usageEntry = pgView("usage_entry", {
	entry: text("entry").notNull(),
	installs: integer("installs").notNull(),
}).as(grouped("install_entry", "entry", eventIs(STARTED), "ASC"));

/** Whether the install is a Host. The first install event wins. */
export const usageHost = pgView("usage_host", {
	host: boolean("host").notNull(),
	installs: integer("installs").notNull(),
}).as(sql`
	SELECT host, count(*)::int AS installs
	FROM (
		SELECT DISTINCT ON (install_id) install_id, install_host AS host
		FROM ${usageFact}
		WHERE install_id IS NOT NULL
			AND ${eventIs(STARTED)}
			AND install_host IS NOT NULL
		ORDER BY install_id, event_time ASC
	) picked
	GROUP BY 1
`);

/** Starter of the first flow each install created. */
export const usageStarter = pgView("usage_starter", {
	starter: text("starter"),
	fromSource: text("from_source"),
	installs: integer("installs").notNull(),
}).as(sql`
	SELECT flow_starter AS starter, flow_from AS from_source, count(*)::int AS installs
	FROM (
		SELECT DISTINCT ON (install_id) install_id, flow_starter, flow_from
		FROM ${usageFact}
		WHERE install_id IS NOT NULL AND ${eventIs(FLOW)}
		ORDER BY install_id, event_time ASC
	) picked
	GROUP BY 1, 2
`);

/** Runs on each UTC day. */
export const usageRunDay = pgView("usage_run_day", {
	day: text("day").notNull(),
	runs: integer("runs").notNull(),
}).as(sql`
	SELECT
		to_char((event_time AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
		count(*)::int AS runs
	FROM ${usageFact}
	WHERE ${eventIs(RUN)}
	GROUP BY 1
`);

/** How runs end. */
export const usageRunEnding = pgView("usage_run_ending", {
	endReason: text("end_reason"),
	runs: integer("runs").notNull(),
}).as(sql`
	SELECT end_reason, count(*)::int AS runs
	FROM ${usageFact}
	WHERE ${eventIs(RUN)}
	GROUP BY 1
`);

const KNOWN_GUARDS = members(RUN, "end_reason").filter((value) =>
	value.startsWith("guard."),
);

/** Every known guard, including those that stopped no run, plus any other guard that did. */
export const usageGuard = pgView("usage_guard", {
	guard: text("guard").notNull(),
	runs: integer("runs").notNull(),
}).as(sql`
	SELECT g.guard, coalesce(seen.runs, 0)::int AS runs
	FROM (VALUES ${sql.join(
		KNOWN_GUARDS.map((guard) => sql`(${lit(guard)})`),
		sql`, `,
	)}) AS g(guard)
	LEFT JOIN (
		SELECT end_reason AS guard, count(*)::int AS runs
		FROM ${usageFact}
		WHERE ${eventIs(RUN)} AND end_reason LIKE 'guard.%'
		GROUP BY 1
	) seen ON seen.guard = g.guard
	UNION ALL
	SELECT end_reason AS guard, count(*)::int AS runs
	FROM ${usageFact}
	WHERE ${eventIs(RUN)}
		AND end_reason LIKE 'guard.%'
		AND end_reason NOT IN (${sql.join(
			KNOWN_GUARDS.map((guard) => lit(guard)),
			sql`, `,
		)})
	GROUP BY 1
`);
