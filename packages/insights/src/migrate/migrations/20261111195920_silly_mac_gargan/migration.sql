DROP VIEW "usage_fact" CASCADE;--> statement-breakpoint
CREATE VIEW "usage_fact" AS (
	SELECT
		id,
		install_id,
		event_name,
		event_time,
		service_version,
		os_type,
		host_arch,
		country,
		attributes->>'nightshift.run.end_reason' AS end_reason,
		attributes->>'nightshift.run.status' AS run_status,
		(attributes->>'nightshift.run.cost_usd')::double precision AS cost_usd,
		(attributes->>'nightshift.run.needed_you')::boolean AS needed_you,
		attributes->>'nightshift.run.id' AS run_id,
		CASE
			WHEN event_name = 'nightshift.run.scored' THEN attributes->>'nightshift.score.name'
			WHEN event_name = 'nightshift.pull_request.useful' THEN 'useful'
			WHEN event_name = 'nightshift.pull_request.outcome' THEN CASE attributes->>'nightshift.pull_request.outcome'
				WHEN 'merged' THEN 'pr_merged' WHEN 'closed' THEN 'pr_closed' WHEN 'reverted' THEN 'reverted_within_7d'
				ELSE '_OTHER'
			END
		END AS score_name,
		CASE
			WHEN event_name = 'nightshift.run.scored' THEN (attributes->>'nightshift.score.value')::double precision
			WHEN event_name = 'nightshift.pull_request.useful' THEN CASE WHEN (attributes->>'nightshift.pull_request.useful')::boolean THEN 1 ELSE 0 END
			WHEN event_name = 'nightshift.pull_request.outcome' THEN 1
		END::double precision AS score_value,
		CASE
			WHEN event_name = 'nightshift.run.scored' THEN (attributes->>'nightshift.score.hours')::double precision
			WHEN event_name = 'nightshift.pull_request.outcome' THEN (attributes->>'nightshift.pull_request.hours')::double precision
		END AS score_hours,
		attributes->>'nightshift.gate.by' AS gate_by,
		attributes->>'nightshift.gate.via' AS gate_via,
		(attributes->>'nightshift.gate.wait')::double precision AS gate_wait,
		(attributes->>'nightshift.install.agents')::double precision AS agents,
		attributes->>'nightshift.install.entry' AS install_entry,
		(attributes->>'nightshift.install.host')::boolean AS install_host,
		attributes->>'nightshift.flow.from' AS flow_from,
		attributes->>'nightshift.flow.starter' AS flow_starter
	FROM "usage_event"
);--> statement-breakpoint
CREATE VIEW "usage_agent_count" AS (
	SELECT agents::int AS agents, count(*)::int AS installs
	FROM (
		SELECT install_id, max(agents) AS agents
		FROM "usage_fact"
		WHERE event_name = 'nightshift.install.active' AND agents IS NOT NULL AND install_id IS NOT NULL
		GROUP BY install_id
	) per_install
	GROUP BY 1
);--> statement-breakpoint
CREATE VIEW "usage_agent_share" AS (
	WITH installs AS (
		SELECT count(DISTINCT install_id)::int AS total
		FROM "usage_fact"
		WHERE install_id IS NOT NULL
	),
	multi AS (
		SELECT count(*)::int AS n
		FROM (
			SELECT install_id
			FROM "usage_fact"
			WHERE event_name = 'nightshift.install.active' AND agents IS NOT NULL AND install_id IS NOT NULL
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
);--> statement-breakpoint
CREATE VIEW "usage_arch" AS (
		SELECT arch, count(*)::int AS installs
		FROM (
			SELECT DISTINCT ON (install_id) install_id, host_arch AS arch
			FROM "usage_fact"
			WHERE install_id IS NOT NULL AND host_arch IS NOT NULL AND (TRUE)
			ORDER BY install_id, event_time DESC
		) picked
		GROUP BY 1
	);--> statement-breakpoint
CREATE VIEW "usage_cohort" AS (
	WITH first_run AS (
		SELECT
			install_id,
			date_trunc('week', min(event_time) AT TIME ZONE 'UTC') AS cohort
		FROM "usage_fact"
		WHERE event_name = 'nightshift.run.ended' AND install_id IS NOT NULL
		GROUP BY install_id
	),
	runs AS (
		SELECT DISTINCT
			install_id,
			date_trunc('week', event_time AT TIME ZONE 'UTC') AS week
		FROM "usage_fact"
		WHERE event_name = 'nightshift.run.ended' AND install_id IS NOT NULL
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
);--> statement-breakpoint
CREATE VIEW "usage_days_per_week" AS (
	SELECT avg(days::double precision / installs_with_runs) AS days_per_week
	FROM (
	SELECT
		to_char(date_trunc('week', event_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
		count(DISTINCT install_id)::int AS active_installs,
		count(DISTINCT install_id) FILTER (WHERE event_name = 'nightshift.run.ended')::int AS installs_with_runs,
		count(DISTINCT (install_id, (event_time AT TIME ZONE 'UTC')::date)) FILTER (
			WHERE event_name = 'nightshift.run.ended'
		)::int AS days
	FROM "usage_fact"
	WHERE install_id IS NOT NULL
	GROUP BY 1
) weeks
	WHERE installs_with_runs > 0
);--> statement-breakpoint
CREATE VIEW "usage_entry" AS (
		SELECT entry, count(*)::int AS installs
		FROM (
			SELECT DISTINCT ON (install_id) install_id, install_entry AS entry
			FROM "usage_fact"
			WHERE install_id IS NOT NULL AND install_entry IS NOT NULL AND (event_name = 'nightshift.install.started')
			ORDER BY install_id, event_time ASC
		) picked
		GROUP BY 1
	);--> statement-breakpoint
CREATE VIEW "usage_funnel_install" AS (
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
		step_useful,
		CASE WHEN step_install IS NULL THEN 0 WHEN step_agent IS NULL THEN 1 WHEN step_project IS NULL THEN 2 WHEN step_checked IS NULL THEN 3 WHEN step_flow IS NULL THEN 4 WHEN step_schedule IS NULL THEN 5 WHEN step_run IS NULL THEN 6 WHEN step_finished IS NULL THEN 7 WHEN step_useful IS NULL THEN 8 ELSE 9 END AS consecutive
	FROM (
		SELECT
			install_id,
			min(event_time) FILTER (WHERE event_name = 'nightshift.install.started') AS step_install,
			min(event_time) FILTER (WHERE event_name = 'nightshift.agent.checked') AS step_agent,
			min(event_time) FILTER (WHERE event_name = 'nightshift.project.added') AS step_project,
			min(event_time) FILTER (WHERE event_name = 'nightshift.project.checked') AS step_checked,
			min(event_time) FILTER (WHERE event_name = 'nightshift.flow.created') AS step_flow,
			min(event_time) FILTER (WHERE event_name = 'nightshift.schedule.changed') AS step_schedule,
			min(event_time) FILTER (WHERE event_name = 'nightshift.run.ended') AS step_run,
			min(event_time) FILTER (WHERE event_name = 'nightshift.run.ended' AND run_status = 'finished') AS step_finished,
			min(event_time) FILTER (WHERE score_name = 'useful' AND score_value > 0) AS step_useful
		FROM "usage_fact"
		WHERE install_id IS NOT NULL
		GROUP BY install_id
	) steps
);--> statement-breakpoint
CREATE VIEW "usage_funnel_step" AS (
		SELECT
			'install' AS step,
			1::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 1)::int AS installs,
			count(*) FILTER (WHERE consecutive = 1 AND 1 < 9)::int AS stopped,
			NULL::double precision AS median_seconds_from_install,
			NULL::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'agent' AS step,
			2::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 2)::int AS installs,
			count(*) FILTER (WHERE consecutive = 2 AND 2 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_agent - step_install))) FILTER (WHERE consecutive >= 2 AND step_install IS NOT NULL AND step_agent IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_agent - step_install))) FILTER (WHERE consecutive >= 2 AND step_install IS NOT NULL AND step_agent IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'project' AS step,
			3::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 3)::int AS installs,
			count(*) FILTER (WHERE consecutive = 3 AND 3 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_project - step_install))) FILTER (WHERE consecutive >= 3 AND step_install IS NOT NULL AND step_project IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_project - step_agent))) FILTER (WHERE consecutive >= 3 AND step_agent IS NOT NULL AND step_project IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'checked' AS step,
			4::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 4)::int AS installs,
			count(*) FILTER (WHERE consecutive = 4 AND 4 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_checked - step_install))) FILTER (WHERE consecutive >= 4 AND step_install IS NOT NULL AND step_checked IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_checked - step_project))) FILTER (WHERE consecutive >= 4 AND step_project IS NOT NULL AND step_checked IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'flow' AS step,
			5::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 5)::int AS installs,
			count(*) FILTER (WHERE consecutive = 5 AND 5 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_flow - step_install))) FILTER (WHERE consecutive >= 5 AND step_install IS NOT NULL AND step_flow IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_flow - step_checked))) FILTER (WHERE consecutive >= 5 AND step_checked IS NOT NULL AND step_flow IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'schedule' AS step,
			6::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 6)::int AS installs,
			count(*) FILTER (WHERE consecutive = 6 AND 6 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_schedule - step_install))) FILTER (WHERE consecutive >= 6 AND step_install IS NOT NULL AND step_schedule IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_schedule - step_flow))) FILTER (WHERE consecutive >= 6 AND step_flow IS NOT NULL AND step_schedule IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'run' AS step,
			7::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 7)::int AS installs,
			count(*) FILTER (WHERE consecutive = 7 AND 7 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_run - step_install))) FILTER (WHERE consecutive >= 7 AND step_install IS NOT NULL AND step_run IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_run - step_schedule))) FILTER (WHERE consecutive >= 7 AND step_schedule IS NOT NULL AND step_run IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'finished' AS step,
			8::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 8)::int AS installs,
			count(*) FILTER (WHERE consecutive = 8 AND 8 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_finished - step_install))) FILTER (WHERE consecutive >= 8 AND step_install IS NOT NULL AND step_finished IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_finished - step_run))) FILTER (WHERE consecutive >= 8 AND step_run IS NOT NULL AND step_finished IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	 UNION ALL 
		SELECT
			'useful' AS step,
			9::int AS step_order,
			count(*) FILTER (WHERE consecutive >= 9)::int AS installs,
			count(*) FILTER (WHERE consecutive = 9 AND 9 < 9)::int AS stopped,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_useful - step_install))) FILTER (WHERE consecutive >= 9 AND step_install IS NOT NULL AND step_useful IS NOT NULL))::double precision AS median_seconds_from_install,
			(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (step_useful - step_finished))) FILTER (WHERE consecutive >= 9 AND step_finished IS NOT NULL AND step_useful IS NOT NULL))::double precision AS median_seconds_from_previous
		FROM "usage_funnel_install"
	);--> statement-breakpoint
CREATE VIEW "usage_gates" AS (
	SELECT
		count(*) FILTER (WHERE gate_by = 'person')::int AS by_person,
		count(*) FILTER (WHERE gate_by = 'deadline')::int AS by_deadline,
		(percentile_cont(0.5) WITHIN GROUP (ORDER BY gate_wait))::double precision AS median_wait_seconds,
		count(*) FILTER (WHERE gate_via = 'phone')::int AS phone,
		count(*) FILTER (WHERE gate_via = 'web')::int AS web,
		count(*) FILTER (WHERE gate_via = 'lock_screen')::int AS lock_screen,
		count(*) FILTER (
			WHERE gate_via IS NOT NULL
				AND gate_via <> 'phone'
				AND gate_via <> 'web'
				AND gate_via <> 'lock_screen'
		)::int AS other
	FROM "usage_fact"
	WHERE event_name = 'nightshift.gate.answered'
);--> statement-breakpoint
CREATE VIEW "usage_guard" AS (
	SELECT g.guard, coalesce(seen.runs, 0)::int AS runs
	FROM (VALUES ('guard.budget'), ('guard.turns'), ('guard.looping'), ('guard.idle'), ('guard.max_steps')) AS g(guard)
	LEFT JOIN (
		SELECT end_reason AS guard, count(*)::int AS runs
		FROM "usage_fact"
		WHERE event_name = 'nightshift.run.ended' AND end_reason LIKE 'guard.%'
		GROUP BY 1
	) seen ON seen.guard = g.guard
	UNION ALL
	SELECT end_reason AS guard, count(*)::int AS runs
	FROM "usage_fact"
	WHERE event_name = 'nightshift.run.ended'
		AND end_reason LIKE 'guard.%'
		AND end_reason NOT IN ('guard.budget', 'guard.turns', 'guard.looping', 'guard.idle', 'guard.max_steps')
	GROUP BY 1
);--> statement-breakpoint
CREATE VIEW "usage_host" AS (
	SELECT host, count(*)::int AS installs
	FROM (
		SELECT DISTINCT ON (install_id) install_id, install_host AS host
		FROM "usage_fact"
		WHERE install_id IS NOT NULL
			AND event_name = 'nightshift.install.started'
			AND install_host IS NOT NULL
		ORDER BY install_id, event_time ASC
	) picked
	GROUP BY 1
);--> statement-breakpoint
CREATE VIEW "usage_os" AS (
		SELECT os, count(*)::int AS installs
		FROM (
			SELECT DISTINCT ON (install_id) install_id, os_type AS os
			FROM "usage_fact"
			WHERE install_id IS NOT NULL AND os_type IS NOT NULL AND (TRUE)
			ORDER BY install_id, event_time DESC
		) picked
		GROUP BY 1
	);--> statement-breakpoint
CREATE VIEW "usage_pull_request_totals" AS (
	SELECT
		count(*) FILTER (WHERE score_name = 'pr_merged')::int AS merged,
		count(*) FILTER (WHERE score_name = 'pr_closed')::int AS closed,
		count(*) FILTER (WHERE score_name = 'reverted_within_7d')::int AS reverted_within_7_days
	FROM "usage_fact"
);--> statement-breakpoint
CREATE VIEW "usage_pull_request_week" AS (
	SELECT
		install_id,
		to_char(date_trunc('week', event_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
		count(*) FILTER (WHERE score_name = 'pr_merged')::int AS merged,
		count(*) FILTER (WHERE score_name = 'pr_closed')::int AS closed,
		count(*) FILTER (WHERE score_name = 'reverted_within_7d')::int AS reverted_within_7_days
	FROM "usage_fact"
	WHERE install_id IS NOT NULL
		AND score_name IN ('pr_merged', 'pr_closed', 'reverted_within_7d')
	GROUP BY 1, 2
);--> statement-breakpoint
CREATE VIEW "usage_run_day" AS (
	SELECT
		to_char((event_time AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
		count(*)::int AS runs
	FROM "usage_fact"
	WHERE event_name = 'nightshift.run.ended'
	GROUP BY 1
);--> statement-breakpoint
CREATE VIEW "usage_run_ending" AS (
	SELECT end_reason, count(*)::int AS runs
	FROM "usage_fact"
	WHERE event_name = 'nightshift.run.ended'
	GROUP BY 1
);--> statement-breakpoint
CREATE VIEW "usage_useful_run" AS (
	SELECT DISTINCT ON (install_id, run_id)
		install_id,
		run_id,
		event_time AS answered_at,
		score_value > 0 AS useful
	FROM "usage_fact"
	WHERE score_name = 'useful'
		AND install_id IS NOT NULL
		AND run_id IS NOT NULL
		AND score_value IS NOT NULL
	ORDER BY install_id, run_id, event_time DESC, id DESC
);--> statement-breakpoint
CREATE VIEW "usage_run_totals" AS (
	SELECT
		count(*) FILTER (WHERE event_name = 'nightshift.run.ended')::int AS runs,
		count(*) FILTER (WHERE event_name = 'nightshift.run.ended' AND run_status = 'finished')::int AS finished,
		count(*) FILTER (WHERE event_name = 'nightshift.run.ended' AND needed_you IS NOT NULL)::int AS reported_needed_you,
		count(*) FILTER (WHERE event_name = 'nightshift.run.ended' AND needed_you)::int AS needed_you,
		coalesce(sum(cost_usd) FILTER (WHERE event_name = 'nightshift.run.ended'), 0)::double precision AS cost_usd,
		(SELECT count(*) FROM "usage_useful_run")::int AS answered,
		(SELECT count(*) FROM "usage_useful_run" WHERE useful)::int AS useful
	FROM "usage_fact"
);--> statement-breakpoint
CREATE VIEW "usage_starter" AS (
	SELECT flow_starter AS starter, flow_from AS from_source, count(*)::int AS installs
	FROM (
		SELECT DISTINCT ON (install_id) install_id, flow_starter, flow_from
		FROM "usage_fact"
		WHERE install_id IS NOT NULL AND event_name = 'nightshift.flow.created'
		ORDER BY install_id, event_time ASC
	) picked
	GROUP BY 1, 2
);--> statement-breakpoint
CREATE VIEW "usage_this_week" AS (
	SELECT
		count(DISTINCT install_id)::int AS active_installs,
		count(DISTINCT (install_id, (event_time AT TIME ZONE 'UTC')::date)) FILTER (
			WHERE event_name = 'nightshift.run.ended'
		)::int AS days_with_runs
	FROM "usage_fact"
	WHERE install_id IS NOT NULL
		AND date_trunc('week', event_time AT TIME ZONE 'UTC')
			= date_trunc('week', (now() AT TIME ZONE 'UTC'))
);--> statement-breakpoint
CREATE VIEW "usage_time_to_first" AS (
	SELECT
		(percentile_cont(0.5) WITHIN GROUP (
			ORDER BY extract(epoch FROM (step_finished - step_install))
		) FILTER (
			WHERE step_install IS NOT NULL
				AND step_finished IS NOT NULL
				AND step_finished >= step_install
		))::double precision AS median_seconds_to_finished,
		(percentile_cont(0.5) WITHIN GROUP (
			ORDER BY extract(epoch FROM (step_useful - step_install))
		) FILTER (
			WHERE step_install IS NOT NULL
				AND step_useful IS NOT NULL
				AND step_useful >= step_install
		))::double precision AS median_seconds_to_useful
	FROM "usage_funnel_install"
);--> statement-breakpoint
CREATE VIEW "usage_version" AS (
		SELECT version, count(*)::int AS installs
		FROM (
			SELECT DISTINCT ON (install_id) install_id, service_version AS version
			FROM "usage_fact"
			WHERE install_id IS NOT NULL AND service_version IS NOT NULL AND (TRUE)
			ORDER BY install_id, event_time DESC
		) picked
		GROUP BY 1
	);--> statement-breakpoint
CREATE VIEW "usage_week" AS (
	SELECT
		to_char(date_trunc('week', event_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
		count(DISTINCT install_id)::int AS active_installs,
		count(DISTINCT install_id) FILTER (WHERE event_name = 'nightshift.run.ended')::int AS installs_with_runs,
		count(DISTINCT (install_id, (event_time AT TIME ZONE 'UTC')::date)) FILTER (
			WHERE event_name = 'nightshift.run.ended'
		)::int AS days
	FROM "usage_fact"
	WHERE install_id IS NOT NULL
	GROUP BY 1
);