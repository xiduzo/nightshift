ALTER TABLE `run` ADD `flow_revision` text;--> statement-breakpoint
ALTER TABLE `run` ADD `body_flow_revisions` text DEFAULT '{}' NOT NULL;