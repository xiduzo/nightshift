CREATE TABLE `space_merge` (
	`from_space` text PRIMARY KEY,
	`host_id` text NOT NULL,
	`person_id` text NOT NULL,
	`state` text NOT NULL,
	`to_space` text,
	`project_map` text,
	`person_map` text,
	`joined` text DEFAULT '[]' NOT NULL,
	`backup` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
