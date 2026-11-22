import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../port";

/**
 * A tool as rules give it: its name, what it is for, its fields as a JSON
 * Schema object, and what it answers to a call. The knowledge tools are
 * such specs (`@nightshift/agents/knowledge`).
 */
export type ToolSpec = {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, { type: string; description: string }>;
		required: string[];
	};
	server(args: unknown): Promise<string>;
};

/** The specs as tools a session takes: bridged into it like `report_step`. */
export function asBridgedTools(specs: readonly ToolSpec[]): BridgedTool[] {
	return specs.map((spec) =>
		toolDefinition({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
		}).server((args: unknown) => spec.server(args)),
	);
}
