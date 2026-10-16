import type { Database } from "@nightshift/db";
import { cliTool } from "@nightshift/db/schema/nightshift";
import { cliNameSchema } from "@nightshift/flows";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * CLI tools: programs on this computer (`gh`, `aws`), defined once on this
 * daemon (the Agents page, under Tools). An Agent node or profile lists the
 * ones its agent may run; the harness then allows them without a prompt.
 * A run whose flow names one the daemon does not have, or one this computer
 * cannot find, refuses to start.
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

export function createCliToolStore(options: { db: Database }): CliToolStore {
	const { db } = options;
	const tools = new Map<string, CliTool>();

	return {
		async load() {
			tools.clear();
			for (const row of await db.select().from(cliTool)) {
				if (!cliNameSchema.safeParse(row.name).success) continue;
				tools.set(row.name, {
					name: row.name,
					description: row.description,
					updatedAt: row.updatedAt.getTime(),
				});
			}
		},
		names: () => new Set(tools.keys()),
		list: () =>
			[...tools.values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: (name) => tools.get(name) ?? null,
		async save(input) {
			const parsed = cliToolInputSchema.parse(input);
			const description = parsed.description || null;
			const [row] = await db
				.insert(cliTool)
				.values({ name: parsed.name, description })
				.onConflictDoUpdate({
					target: cliTool.name,
					set: {
						description,
						updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
					},
				})
				.returning();
			const saved = {
				name: parsed.name,
				description,
				updatedAt: row?.updatedAt.getTime() ?? Date.now(),
			};
			tools.set(parsed.name, saved);
			return saved;
		},
		async remove(name) {
			await db.delete(cliTool).where(eq(cliTool.name, name));
			tools.delete(name);
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
