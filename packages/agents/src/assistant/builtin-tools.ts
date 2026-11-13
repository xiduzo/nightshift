/**
 * What each of Night Shift's own agents may call. Every tool has one
 * tier, and every agent has a list of tool names. A session gets exactly
 * the tools its agent lists: a tool that is not on the list is not handed
 * to the agent at all, so no wording can call it.
 *
 * - `read`: reads in one project. Runs without a question.
 * - `propose`: makes something the person looks at. Nothing changes until
 *   the person applies it.
 * - `act`: changes something (saves a flow, starts or stops a run, answers
 *   a Gate). No built-in agent has one: only an agent in the person's own
 *   terminal does, with the person's rights.
 */
import type { BuiltinAgentId } from "@nightshift/flows";
import type { BridgedTool } from "../port";

export type ToolTier = "read" | "propose" | "act";

/** The tier of every tool Night Shift hands to an agent, by its name. */
export const TOOL_TIERS: Record<string, ToolTier> = {
	get_draft: "read",
	list_projects: "read",
	list_flows: "read",
	get_flow: "read",
	list_profiles: "read",
	list_tools: "read",
	list_skills: "read",
	list_runs: "read",
	get_run: "read",
	get_step_transcript: "read",
	get_spend: "read",
	list_revisions: "read",
	get_revision: "read",
	get_prices: "read",
	needs_me: "read",
	search_knowledge: "read",
	read_knowledge: "read",
	check_flow: "propose",
	propose_flow: "propose",
	save_flow: "act",
	start_run: "act",
	stop_run: "act",
	answer_gate: "act",
};

const BUILD = [
	"get_draft",
	"list_flows",
	"get_flow",
	"list_profiles",
	"list_tools",
	"list_skills",
	"check_flow",
	"propose_flow",
] as const;

/**
 * The tools of each built-in agent. The Builder reads the draft and the
 * names a node may use. The Improver also reads what happened: the runs,
 * their cost and the changes of the flow. The other five get none: what
 * they need is in their prompt.
 */
export const BUILTIN_TOOLS: Record<BuiltinAgentId, readonly string[]> = {
	builder: BUILD,
	improver: [
		...BUILD,
		"list_runs",
		"get_run",
		"get_step_transcript",
		"get_spend",
		"list_revisions",
		"get_revision",
		"get_prices",
	],
	explainer: [],
	"field-writer": [],
	learner: [],
	decider: [],
	"brief-writer": [],
};

/** The highest tier a built-in agent may hold. */
export const BUILTIN_TOP_TIER: ToolTier = "propose";

const ORDER: readonly ToolTier[] = ["read", "propose", "act"];

/** Whether `tier` is at most `top`. */
export function withinTier(tier: ToolTier, top: ToolTier): boolean {
	return ORDER.indexOf(tier) <= ORDER.indexOf(top);
}

/** The tools of `tools` that the agent `id` lists, in the order of `tools`. */
export function toolsOf(
	id: BuiltinAgentId,
	tools: readonly BridgedTool[],
): BridgedTool[] {
	const listed = BUILTIN_TOOLS[id];
	return tools.filter((tool) => listed.includes(tool.name));
}

/**
 * The MCP annotations of a tool, from its tier: hints for the client of an
 * agent in a terminal, so it can ask before a write. A tool with no tier
 * counts as one that acts.
 */
export function toolAnnotations(name: string): {
	readOnlyHint: boolean;
	destructiveHint: boolean;
} {
	const tier = TOOL_TIERS[name] ?? "act";
	return { readOnlyHint: tier !== "act", destructiveHint: tier === "act" };
}
