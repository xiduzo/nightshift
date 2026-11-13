import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { spaceId } from "./columns";

// Owner: `@nightshift/engine`, `assistant/answer-costs.ts`: what each
// answer of Night Shift's own agents cost. The daemon keeps a row through
// the engine when an answer ends. The Spend page reads them through the
// engine. `@nightshift/devices` carries the rows of a Space a Host keeps
// to that Host and on to the Space's other computers.

/**
 * What one answer of a built-in agent cost: a chat answer of the Builder
 * or the Improver, an explanation of the Explainer, a suggestion of the
 * Field writer. One row per answer, kept when its stream ends, a failed
 * or stopped answer too when it spent something. The Decider and the
 * Brief writer have no rows: their cost is in the run.
 *
 * A Replica has the rows of its own answers, and the rows a Host gave it
 * of the other computers of a Space (`device_id` set). The Host that
 * keeps a Space has the rows of every computer in it.
 */
export const answerCost = sqliteTable(
	"answer_cost",
	{
		/** Its number on this Replica: a Host serves its rows by it. */
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** The answer on every Replica: a row that comes again is the same answer. */
		key: text("key").notNull(),
		spaceId: spaceId(),
		/** The project the answer was about. No foreign key: a project may go. Null when not known. */
		projectId: text("project_id"),
		/** The Person who asked. */
		personId: text("person_id").notNull(),
		/** The built-in agent: `builder`, `improver`, `explainer` or `field-writer`. */
		agent: text("agent").notNull(),
		/** The place in the product that started it (`AgentEntryId`). Null when not known. */
		entry: text("entry"),
		inputTokens: integer("input_tokens").notNull(),
		outputTokens: integer("output_tokens").notNull(),
		/** Null when the agent did not report its cost. */
		costUsd: real("cost_usd"),
		/** When the answer ended. */
		at: integer("at", { mode: "timestamp_ms" }).notNull(),
		/** The Device that answered, as the Host names it. Null: this computer. */
		deviceId: text("device_id"),
		/** Its number on the Host that gave it: this Replica's cursor with that Host, per Space. Null: not from a Host. */
		hostSeq: integer("host_seq"),
		/** When the Host that keeps its Space took it. Null: not yet, or no Host keeps the Space. */
		sentAt: integer("sent_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		index("answer_cost_space_at_idx").on(table.spaceId, table.at),
		uniqueIndex("answer_cost_key_idx").on(table.key),
	],
);
