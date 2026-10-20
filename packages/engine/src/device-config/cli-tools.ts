import { cliNameSchema } from "@nightshift/flows";
import { z } from "zod";

import { type DeviceDocument, mapView } from "./device-document";

/**
 * CLI tools: programs on this computer (`gh`, `aws`), defined once in its
 * Device document (the Agents page, under Tools). An Agent node or profile
 * lists the ones its agent may run; the harness then allows them without a
 * prompt. A run whose flow names one the daemon does not have, or one this
 * computer cannot find, refuses to start.
 */

export const cliToolInputSchema = z.object({
	name: cliNameSchema,
	description: z.string().trim().max(500).optional(),
});
export type CliToolInput = z.input<typeof cliToolInputSchema>;

export type CliTool = {
	name: string;
	description: string | null;
	updatedAt: number;
};

export type CliToolStore = {
	/** Reads the CLI tools. Call once before `names`. */
	load(): Promise<void>;
	/** The CLI tool names, for the start check. */
	names(): ReadonlySet<string>;
	list(): CliTool[];
	get(name: string): CliTool | null;
	/** Creates or replaces a CLI tool. */
	save(input: CliToolInput): Promise<CliTool>;
	remove(name: string): Promise<void>;
};

/** A CLI tool as the Device document holds it. */
const entrySchema = z.object({
	description: z.string().nullable(),
	updatedAt: z.number(),
});

export function createCliToolStore(options: {
	document: DeviceDocument;
}): CliToolStore {
	const { document } = options;
	const tools = mapView(document, document.cliTools, () => {
		const out = new Map<string, CliTool>();
		for (const [name, value] of document.cliTools.entries()) {
			const entry = entrySchema.safeParse(value);
			if (!entry.success || !cliNameSchema.safeParse(name).success) continue;
			out.set(name, { name, ...entry.data });
		}
		return out;
	});

	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		names: () => new Set(tools().keys()),
		list: () =>
			[...tools().values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: (name) => tools().get(name) ?? null,
		async save(input) {
			const parsed = cliToolInputSchema.parse(input);
			const saved: CliTool = {
				name: parsed.name,
				description: parsed.description || null,
				updatedAt: Date.now(),
			};
			await document.change(() => {
				document.cliTools.set(parsed.name, {
					description: saved.description,
					updatedAt: saved.updatedAt,
				});
			});
			return saved;
		},
		async remove(name) {
			await document.change(() => {
				document.cliTools.delete(name);
			});
		},
	};
}

/** What an agent learns about one of its CLI tools when its session starts. */
export type CliToolGuide = {
	name: string;
	description: string | null;
	/** The program's own help (`--help`). Null when it has none. */
	help: string | null;
};

/**
 * The prompt section that tells an agent which CLI tools it has: each
 * name, the description its owner wrote, and the program's help. The help
 * is quoted in a fence longer than any backtick run inside it.
 */
export function cliToolsInstruction(tools: readonly CliToolGuide[]): string {
	if (tools.length === 0) return "";
	const sections = tools.map((tool) => {
		const lines = [`### ${tool.name}`];
		if (tool.description) lines.push("", tool.description);
		if (tool.help) {
			const longest = Math.max(
				0,
				...(tool.help.match(/`+/g) ?? []).map((run) => run.length),
			);
			const fence = "`".repeat(Math.max(3, longest + 1));
			lines.push(
				"",
				`\`${tool.name} --help\`:`,
				"",
				`${fence}text`,
				tool.help,
				fence,
			);
		}
		return lines.join("\n");
	});
	return [
		"## CLI tools",
		"",
		"You can run these programs in your shell. Use them instead of guessing at an API. For the details of one command, run it with `--help`.",
		"",
		sections.join("\n\n"),
	].join("\n");
}
