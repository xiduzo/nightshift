-- Every run has a starter. A run this computer walks that names none (a
-- schedule started it, or it is from before Members) is the run of this
-- computer's Person, as the Host of its Space knows them.
UPDATE `run` SET `started_by` = coalesce((SELECT `host_link`.`person_id` FROM `host_space` INNER JOIN `host_link` ON `host_link`.`host_id` = `host_space`.`host_id` WHERE `host_space`.`space_id` = `run`.`space_id`), (SELECT `owner_id` FROM `device` WHERE `self` = 1)) WHERE `started_by` IS NULL AND `walker_id` = (SELECT `id` FROM `device` WHERE `self` = 1);
