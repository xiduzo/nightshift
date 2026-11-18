import type { Permissions } from "@nightshift/auth";
import { z } from "zod";

import type { Context } from "../context";
import { ownsThisComputer } from "../procedures";

/**
 * Who asks about a project's knowledge, and what they may change: the
 * rights of this computer's owner, the roles each change needs, the mark
 * of an agent that asks, and the input that names the project.
 */

/** What the person may change: this computer's schedules are its owner's. */
export function rightsOf(context: Pick<Context, "access" | "daemon">) {
	return { schedules: ownsThisComputer(context) };
}

/**
 * The roles each change of a source needs, for its procedure and for what
 * `knowledge.get` says the person may do. Adding or editing a source saves
 * a flow. Removing one removes a flow. Syncing one, and removing its
 * files, changes the knowledge: a role that may start runs (ADR 4).
 */
export const MAY = {
	save: { flow: ["save"] },
	remove: { flow: ["remove"] },
	changeKnowledge: { run: ["start"] },
} satisfies Record<string, Permissions>;

/**
 * An agent asks, through the nightshift MCP server: the search or the read
 * is logged, for the Knowledge page. The page's own searches are not.
 */
export const agentSchema = z.boolean().optional();

/** A project of the Space. */
export const projectInput = z.object({ projectId: z.string() });
