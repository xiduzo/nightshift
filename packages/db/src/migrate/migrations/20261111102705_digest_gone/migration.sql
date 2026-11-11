DELETE FROM `notification_delivery` WHERE `kind` = 'digest';--> statement-breakpoint
ALTER TABLE `notification_delivery` DROP COLUMN `read_at`;--> statement-breakpoint
ALTER TABLE `notification_settings` DROP COLUMN `digest_when`;--> statement-breakpoint
ALTER TABLE `notification_settings` DROP COLUMN `digest_time`;