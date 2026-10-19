CREATE TABLE `ydoc` (
	`name` text PRIMARY KEY,
	`state` blob NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
