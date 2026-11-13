import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

import { spaceId } from "./columns";

// Owner: `@nightshift/engine`, `assistant/answer-costs.ts`: what each
// answer of Night Shift's own agents cost on this computer. The daemon
// keeps a row through the engine when an answer ends. The Spend page
// reads them through the engine.

/**
 * What one answer of a built-in agent cost: a chat answer of the Builder
 * or the Improver, an explanation of the Explainer, a suggestion of the
 * Field writer. One row per answer, kept when its stream ends, a failed
 * or stopped answer too when it spent something. The Decider and the
 * Brief writer have no rows: their cost is in the run. Not synced: the
 * rows stay on the computer that answered.
 */
export const answerCost = sqliteTable(
	"answer_cost",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
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
	},
	(table) => [index("answer_cost_space_at_idx").on(table.spaceId, table.at)],
);
