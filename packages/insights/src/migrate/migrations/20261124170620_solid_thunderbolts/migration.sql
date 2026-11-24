CREATE OR REPLACE VIEW "usage_fact" AS (
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
		attributes->>'nightshift.score.name' AS score_name,
		(attributes->>'nightshift.score.value')::double precision AS score_value,
		(attributes->>'nightshift.score.hours')::double precision AS score_hours,
		attributes->>'nightshift.gate.by' AS gate_by,
		attributes->>'nightshift.gate.via' AS gate_via,
		(attributes->>'nightshift.gate.wait')::double precision AS gate_wait,
		(attributes->>'nightshift.install.agents')::double precision AS agents,
		attributes->>'nightshift.install.entry' AS install_entry,
		(attributes->>'nightshift.install.host')::boolean AS install_host,
		attributes->>'nightshift.flow.from' AS flow_from,
		attributes->>'nightshift.flow.starter' AS flow_starter
	FROM "usage_event"
);