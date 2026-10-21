ALTER TABLE `session` ADD `impersonated_by` text;--> statement-breakpoint
ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_expires` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `started_by` text;--> statement-breakpoint
-- The Host admin is the Person of this computer, else the earliest account.
-- Every other Person is a user of the Host.
UPDATE `user` SET `role` = 'user';--> statement-breakpoint
UPDATE `user` SET `role` = 'admin' WHERE `id` = coalesce((SELECT `owner_id` FROM `device` WHERE `self` = 1), (SELECT `id` FROM `user` ORDER BY `created_at`, `id` LIMIT 1));--> statement-breakpoint
-- Runs so far were started by the Person of this computer, unless a schedule
-- started them.
UPDATE `run` SET `started_by` = (SELECT `owner_id` FROM `device` WHERE `self` = 1) WHERE NOT EXISTS (SELECT 1 FROM `event` WHERE `event`.`run_id` = `run`.`id` AND `event`.`type` = 'RunStarted' AND json_extract(`event`.`payload`, '$.trigger.kind') = 'schedule');
