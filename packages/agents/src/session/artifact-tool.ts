/**
 * The artifact tool: how an agent keeps a file for the person, such as a
 * screenshot of a design or a recording of a test.
 *
 * When the session's input has `saveArtifact`, the harness gives the agent
 * one more TanStack AI tool, `save_artifact`, on the same MCP bridge as
 * `report_step`. The tool hands the path and the title to `saveArtifact`,
 * which the Device implements: it copies the file next to the run's
 * history. The agent gets what `saveArtifact` returns, or the error.
 *
 * Plan mode on a `by-mode` harness and a `text` harness run no tools: they
 * get neither the tool nor its instruction.
 */
import { toolDefinition } from "@tanstack/ai";
import type { AgentSessionInput } from "../port";

/** The tool name as the application registers it with `chat({ tools })`. */
export const ARTIFACT_TOOL_NAME = "save_artifact";

/** Appended to the prompt when the session has the tool. */
export const ARTIFACT_INSTRUCTION = `To keep a file for the person who reviews this work, such as a screenshot or a recording, call the \`${ARTIFACT_TOOL_NAME}\` tool with its path and a short title.`;

const inputSchema: Record<string, unknown> = {
	type: "object",
	properties: {
		path: {
			type: "string",
			description:
				"The file to keep: relative to your working directory, or absolute.",
		},
		title: {
			type: "string",
			description: 'A short title for the person, for example "Login page".',
		},
	},
	required: ["path"],
	additionalProperties: false,
};

/** The `save_artifact` tool, bound to the session's `saveArtifact`. */
export function saveArtifactTool(
	save: NonNullable<AgentSessionInput["saveArtifact"]>,
) {
	return toolDefinition({
		name: ARTIFACT_TOOL_NAME,
		description:
			"Keep a file for the person who reviews this work: a screenshot, a recording, a report. Night Shift copies the file, so you can change or delete it afterwards.",
		inputSchema,
	}).server(async (args: unknown) => {
		const input = args as { path?: unknown; title?: unknown };
		if (typeof input?.path !== "string" || input.path.trim() === "") {
			throw new Error("Give the path of the file in `path`.");
		}
		return save({
			path: input.path,
			...(typeof input.title === "string" && input.title.trim() !== ""
				? { title: input.title.trim() }
				: {}),
		});
	});
}
