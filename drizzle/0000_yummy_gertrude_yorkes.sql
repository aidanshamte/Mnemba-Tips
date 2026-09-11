CREATE TABLE `appearances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`started` integer DEFAULT false NOT NULL,
	`minutes` integer DEFAULT 0 NOT NULL,
	`performance_rating` real,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_appearances_match_player` ON `appearances` (`match_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_appearances_player_match` ON `appearances` (`player_id`,`match_id`);--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sport` text NOT NULL,
	`license` text NOT NULL,
	`source_url` text NOT NULL,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_data_sources_name` ON `data_sources` (`name`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`source_id` integer,
	`sport` text NOT NULL,
	`competition` text,
	`starts_at` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`home_team_id` integer,
	`away_team_id` integer,
	`home_score` integer,
	`away_score` integer,
	FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_matches_source_external` ON `matches` (`source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_matches_teams_date` ON `matches` (`home_team_id`,`away_team_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_matches_sport_date` ON `matches` (`sport`,`starts_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`team_id` integer,
	`name` text NOT NULL,
	`position` text,
	`availability` text DEFAULT 'unknown' NOT NULL,
	`form_rating` real DEFAULT 50 NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_players_team` ON `players` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_team_external` ON `players` (`team_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer,
	`model_version` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_predictions_match_created` ON `predictions` (`match_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`source_id` integer,
	`sport` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`competition` text,
	`rating` real DEFAULT 1500 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_teams_source_external` ON `teams` (`source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_teams_sport_name` ON `teams` (`sport`,`name`);
--> statement-breakpoint
PRAGMA optimize;
