-- A run end logged without its code (RunEnded before 2026-11-02 had no
-- `endReason`) gets the code its sentence gives: these are the words the
-- engine wrote then. Every end logged since has its code, and the code is
-- required from this migration on. A code that is missing or null counts
-- as none. A payload that has a code, or that is not a JSON object, stays
-- as it is. The CASE keeps that order: json_type fails on text that is not
-- valid JSON.
UPDATE `event`
SET `payload` = json_set(
	`payload`,
	'$.endReason',
	CASE
		WHEN json_extract(`payload`, '$.status') = 'finished'
			AND coalesce(json_extract(`payload`, '$.result'), '') <> 'failed'
			THEN 'finished'
		WHEN instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'Usage limit:') > 0
			THEN 'agent.usage_limit'
		WHEN instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'The network is down:') > 0
			OR instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'The network was down') > 0
			THEN 'agent.network'
		WHEN coalesce(json_extract(`payload`, '$.reason'), '') = 'Reached the stop time'
			THEN 'stop_time'
		WHEN instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'The run spent $') > 0
			AND instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'budget') > 0
			THEN 'guard.budget'
		WHEN instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'reached its limit of') > 0
			AND instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'turns, so the step stopped') > 0
			THEN 'guard.turns'
		WHEN instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'times in a row with the same input') > 0
			THEN 'guard.looping'
		WHEN instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'showed no activity') > 0
			THEN 'guard.idle'
		WHEN instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'reached the limit of') > 0
			AND instr(coalesce(json_extract(`payload`, '$.reason'), ''), 'steps') > 0
			THEN 'guard.max_steps'
		WHEN json_extract(`payload`, '$.status') = 'stopped'
			AND coalesce(json_extract(`payload`, '$.reason'), '') IN ('', 'Stopped after the running step, as asked.')
			THEN 'stopped_by_person'
		ELSE '_OTHER'
	END
)
WHERE `type` = 'RunEnded'
	AND CASE
		WHEN NOT json_valid(`payload`) THEN 0
		WHEN json_type(`payload`) <> 'object' THEN 0
		ELSE coalesce(json_type(`payload`, '$.endReason'), 'null') = 'null'
	END;--> statement-breakpoint
-- A removal of a run's files no longer says who removed it: since
-- 2026-11-12 only the scheduled cleanup removes them.
UPDATE `event`
SET `payload` = json_remove(`payload`, '$.by')
WHERE `type` = 'WorktreeRemoved'
	AND CASE
		WHEN NOT json_valid(`payload`) THEN 0
		WHEN json_type(`payload`) <> 'object' THEN 0
		ELSE json_type(`payload`, '$.by') IS NOT NULL
	END;
