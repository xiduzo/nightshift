ALTER TABLE `run` ADD `device_names` text;--> statement-breakpoint
-- The plan of a run from before it gets the names of its Devices, as this
-- computer knows them: the run's Device and the Devices its nodes name.
UPDATE `run` SET `device_names` = (SELECT json_group_object(`device`.`id`, `device`.`name`) FROM `device` WHERE `device`.`id` = coalesce(`run`.`device_id`, `run`.`walker_id`) OR `device`.`id` IN (SELECT `value` FROM json_each(CASE WHEN json_valid(`run`.`placements`) THEN CASE WHEN json_type(`run`.`placements`) = 'object' THEN `run`.`placements` ELSE '{}' END ELSE '{}' END)));
