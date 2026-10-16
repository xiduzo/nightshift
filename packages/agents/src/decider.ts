/**
 * The default decider: a short Claude Code session whose only way to answer
 * is the `decide` tool.
 *
 * Why a tool and not `chat({ outputSchema })`: the claude-code adapter does
 * support structured output (`--json-schema`), but it cannot turn off the
 * built-in tools while it also bridges more than one of our tools (`--tools ""`
 * comes only with `toolChoice: 'none'` or one named tool). With a `decide`
 * tool, the answer travels over the MCP bridge; the tool checks the label
 * against the node's labels and the agent gets a tool error to correct a
 * wrong one. It is also the same channel as
 * `report_step`, which is proven in live sessions.
 *
 * The session has no built-in tools: `--tools ""` and `--strict-mcp-config`
 * (see `claudeCommand` in `claude-code.ts`), so it can read nothing and run
 * nothing besides `decide`. It loads no
 * settings tier by default, so no user hooks, plugins, or memory files reach
 * it.
 */
import { toolDefinition } from "@tanstack/ai";
import {
	BRIDGED_MCP_SERVER_NAME,
	type ClaudeCodeSettingSource,
} from "@tanstack/ai-claude-code";
import { z } from "zod";
import {
	type ClaudeCodeProcessOptions,
	runClaudeCodeSession,
	type SessionSetup,
} from "./claude-code";
import { failureKind } from "./translate";
import type {
	AgentErrorKind,
	AgentEvent,
	Decider,
	DecisionInput,
	DecisionResult,
} from "./types";

/** The tool name as the decider registers it with `chat({ tools })`. */
export const DECIDE_TOOL_NAME = "decide";

/** The tool name as Claude Code sees it, for `--allowedTools`. */
export const DECIDE_TOOL_ID = `mcp__${BRIDGED_MCP_SERVER_NAME}__${DECIDE_TOOL_NAME}`;

/** What the tool returns to the agent after a valid decision. */
export const DECIDE_ACK = "Decision recorded. You are done.";

export type Decision = { label: string; notes: string };

export type ClaudeCodeDeciderOptions = ClaudeCodeProcessOptions & {
	/** Settings tiers to load. Default none: no user hooks, plugins, or memory. */
	settingSources?: ClaudeCodeSettingSource[];
	/** `--max-turns`. Default 10, room for a few GitHub reads. */
	maxTurns?: number;
};

/** Why the labels cannot be decided on, or undefined when they are fine. */
export function labelsProblem(
	labels: DecisionInput["labels"],
): string | undefined {
	if (labels.length === 0) return "A decision needs at least one label.";
	const names = labels.map((label) => label.name);
	if (names.some((name) => name.trim() === "")) {
		return "A decision label cannot be empty.";
	}
	const duplicate = names.find((name, i) => names.indexOf(name) !== i);
	if (duplicate !== undefined) {
		return `The decision label "${duplicate}" appears twice.`;
	}
	return undefined;
}

/**
 * The `decide` tool. Its input is checked against the labels: a wrong label
 * throws, so the agent gets a tool error and can call again. The first valid
 * call counts; later calls get an error.
 */
export function decideTool(
	labels: DecisionInput["labels"],
	record: (decision: Decision) => void,
) {
	const names = labels.map((label) => label.name) as [string, ...string[]];
	const schema = z.object({
		label: z
			.enum(names)
			.describe("The label you pick. Exactly one of the listed labels."),
		notes: z.string().describe("One to three sentences: why this label."),
	});
	let decided: Decision | undefined;
	return toolDefinition({
		name: DECIDE_TOOL_NAME,
		description:
			"Give your decision. Call it exactly once, with one of the listed labels.",
		inputSchema: schema,
	}).server((raw: unknown) => {
		if (decided) {
			throw new Error(
				`A decision is already recorded: "${decided.label}". Do not call decide again.`,
			);
		}
		const parsed = schema.safeParse(raw);
		if (!parsed.success) {
			throw new Error(
				`Invalid decision. \`label\` must be one of: ${names.map((n) => `"${n}"`).join(", ")}, and \`notes\` a string.`,
			);
		}
		decided = { label: parsed.data.label, notes: parsed.data.notes.trim() };
		record(decided);
		return DECIDE_ACK;
	});
}

/** The prompt of a decision session: the question, the labels, and how to answer. */
export function decisionPrompt(
	input: Pick<DecisionInput, "prompt" | "labels">,
): string {
	const labels = input.labels
		.map((label) =>
			label.description?.trim()
				? `- \`${label.name}\`: ${label.description.trim()}`
				: `- \`${label.name}\``,
		)
		.join("\n");
	return [
		"You make one decision for an automated flow. Read the question, pick one label, and answer with the `decide` tool.",
		`## Question\n\n${input.prompt.trim()}`,
		`## Labels\n\n${labels}`,
		[
			"Call the `decide` tool exactly once, with `label` set to one of the labels above and `notes` set to one to three sentences on why.",
			"You have no other tools.",
			"Do not answer in text only: a decision that is not given with the tool does not count.",
		].join(" "),
	].join("\n\n");
}

function failed(
	errorKind: AgentErrorKind,
	message: string,
	costUsd: number | null,
): DecisionResult {
	return { kind: "error", errorKind, message, costUsd };
}

async function decideWithClaudeCode(
	input: DecisionInput,
	options: ClaudeCodeDeciderOptions,
): Promise<DecisionResult> {
	const problem = labelsProblem(input.labels);
	if (problem) return failed("harness", problem, null);
	if (input.signal.aborted) {
		return failed("aborted", "The decision was aborted", null);
	}

	let decision: Decision | undefined;
	const setup: SessionSetup = {
		prompt: decisionPrompt(input),
		tools: [
			decideTool(input.labels, (d) => {
				decision = d;
			}),
		],
		allowedTools: [DECIDE_TOOL_ID],
		stepReport: false,
		bridgedToolsOnly: true,
		settingSources: options.settingSources ?? [],
		maxTurns: options.maxTurns ?? 10,
	};

	let terminal: AgentEvent | undefined;
	for await (const event of runClaudeCodeSession(
		{
			cwd: input.cwd,
			model: input.model,
			permissionMode: "default",
			signal: input.signal,
		},
		setup,
		options,
	)) {
		if (event.type === "finished" || event.type === "error") terminal = event;
	}

	const costUsd =
		terminal?.type === "finished" ? (terminal.usage?.costUsd ?? null) : null;
	if (
		input.signal.aborted ||
		(terminal?.type === "error" && terminal.kind === "aborted")
	) {
		return failed("aborted", "The decision was aborted", costUsd);
	}
	// A recorded decision counts even when the session failed after it.
	if (decision) return { kind: "decided", ...decision, costUsd };
	// `usage-limit` and `network` pass through, so the engine waits and asks again.
	if (terminal?.type === "error") {
		return failed(terminal.kind, terminal.message, costUsd);
	}
	return failed(
		"harness",
		"The decider ended without a valid `decide` call.",
		costUsd,
	);
}

/** The default decider: a short Claude Code session on the host, in `input.cwd`. */
export function claudeCodeDecider(
	options: ClaudeCodeDeciderOptions = {},
): Decider {
	return {
		name: "claude-code",
		decide: async (input) => {
			try {
				return await decideWithClaudeCode(input, options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return failed(
					input.signal.aborted
						? "aborted"
						: (failureKind(message) ?? "harness"),
					message,
					null,
				);
			}
		},
	};
}
