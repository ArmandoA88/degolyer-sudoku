CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`data` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_class_time` ON `activity` (`classroom_id`,`at`);--> statement-breakpoint
CREATE TABLE `classrooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`code` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classrooms_code_unique` ON `classrooms` (`code`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_student` ON `games` (`student_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`student_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`data` text NOT NULL,
	`completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `records_game_id_unique` ON `records` (`game_id`);--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`code` text NOT NULL,
	`pin_hash` text NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL,
	`theme` text NOT NULL,
	`level_id` text NOT NULL,
	`goal` integer NOT NULL,
	`coins` integer DEFAULT 0 NOT NULL,
	`total_solved` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`best` text DEFAULT '{}' NOT NULL,
	`last_seen` integer DEFAULT 0 NOT NULL,
	`help_requested` integer DEFAULT 0 NOT NULL,
	`teacher_note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_class_code` ON `students` (`classroom_id`,`code`);