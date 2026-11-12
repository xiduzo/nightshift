CREATE VIEW "usage_ladder" AS (
	WITH landed AS (
		SELECT
			install_id,
			attributes->>'nightshift.ladder.kind' AS kind,
			attributes->>'nightshift.ladder.rung' AS rung,
			(attributes->>'nightshift.ladder.cost_usd')::double precision AS cost_usd,
			(attributes->>'nightshift.ladder.unsure')::boolean AS unsure
		FROM "usage_event"
		WHERE event_name = 'nightshift.step.ended'
	)
	SELECT
		kind,
		rung,
		count(*)::int AS landings,
		count(DISTINCT install_id)::int AS installs,
		count(cost_usd)::int AS costed,
		coalesce(sum(cost_usd), 0)::double precision AS cost_usd,
		count(*) FILTER (
			WHERE kind = 'choice' AND rung <> 'rule' AND unsure IS NOT NULL
		)::int AS decided,
		count(*) FILTER (WHERE kind = 'choice' AND unsure)::int AS unsure
	FROM landed
	WHERE kind IS NOT NULL AND rung IS NOT NULL
	GROUP BY GROUPING SETS ((kind, rung), (kind))
);