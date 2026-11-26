ALTER TABLE `host_space` ADD `left_at` integer;--> statement-breakpoint
-- A Space a Host listed before (slug `host-<id>`) that this computer left
-- has no host_space row: it gets one, marked left. Its Host is the one
-- Host that exchanged its runs here, or empty when that is not known.
-- It only adds rows: an existing row is never changed.
INSERT INTO `host_space` (`space_id`, `host_id`, `name`, `role`, `personal`, `left_at`)
SELECT
	`organization`.`id`,
	coalesce(
		(
			SELECT min(`sync_cursor`.`host_id`)
			FROM `sync_cursor`
			WHERE `sync_cursor`.`space_id` = `organization`.`id`
			HAVING count(DISTINCT `sync_cursor`.`host_id`) = 1
		),
		''
	),
	`organization`.`name`,
	'',
	0,
	cast(unixepoch('subsecond') * 1000 as integer)
FROM `organization`
WHERE `organization`.`slug` = 'host-' || `organization`.`id`
	AND NOT EXISTS (
		SELECT 1 FROM `host_space` WHERE `host_space`.`space_id` = `organization`.`id`
	);
