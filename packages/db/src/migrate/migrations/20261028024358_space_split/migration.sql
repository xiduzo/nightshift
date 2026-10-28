CREATE TABLE `space_split` (
	`to_space` text PRIMARY KEY,
	`from_space` text NOT NULL,
	`host_id` text NOT NULL,
	`host_name` text NOT NULL,
	`person_id` text NOT NULL,
	`host_person_id` text NOT NULL,
	`state` text NOT NULL,
	`projects` text,
	`runs` integer DEFAULT 0 NOT NULL,
	`backup` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
