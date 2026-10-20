import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { isCustomHarness } from "@nightshift/flows";
import { HARNESS_FACTS } from "../harnesses";
import type { AgentHarnessName } from "../port";

/** A skill the harness can run: the project's own, or one for every project on this computer. */
export type InstalledSkill = {
	/** What follows the slash: `tdd`, or `figma:figma-use` for a plugin's. */
	name: string;
	description: string | null;
	source: "project" | "computer";
};

/** Where a project keeps its own skills, relative to its folder. */
export const PROJECT_SKILL_DIR = ".agents/skills";

/** The name and description in a SKILL.md's frontmatter. */
function frontmatter(text: string): { name?: string; description?: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!match?.[1]) return {};
	try {
		const data = Bun.YAML.parse(match[1]) as Record<string, unknown> | null;
		return {
			name: typeof data?.name === "string" ? data.name : undefined,
			description:
				typeof data?.description === "string" ? data.description : undefined,
		};
	} catch {
		return {};
	}
}

/**
 * The skills in one folder: each subfolder with a SKILL.md. A subfolder may
 * be a link to the skill elsewhere. Missing folders give none.
 */
async function skillsIn(
	dir: string,
	source: InstalledSkill["source"],
	prefix = "",
): Promise<InstalledSkill[]> {
	const entries = await readdir(dir).catch(() => [] as string[]);
	const skills = await Promise.all(
		entries.map(async (entry) => {
			const text = await readFile(join(dir, entry, "SKILL.md"), "utf8").catch(
				() => null,
			);
			if (text === null) return null;
			const meta = frontmatter(text);
			return {
				name: `${prefix}${meta.name?.trim() || entry}`,
				description: meta.description?.replace(/\s+/g, " ").trim() || null,
				source,
			};
		}),
	);
	return skills.filter((s): s is InstalledSkill => s !== null);
}

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8").catch(() => "null"));
}

/**
 * The skill folders of the Claude Code plugins that are installed and on.
 * A plugin's skill goes by `plugin:skill`.
 */
async function claudePluginSkills(home: string): Promise<InstalledSkill[]> {
	const [installed, settings] = await Promise.all([
		readJson(join(home, ".claude/plugins/installed_plugins.json")).catch(
			() => null,
		),
		readJson(join(home, ".claude/settings.json")).catch(() => null),
	]);
	const plugins =
		(installed as { plugins?: Record<string, { installPath?: string }[]> })
			?.plugins ?? {};
	const enabled =
		(settings as { enabledPlugins?: Record<string, boolean> })
			?.enabledPlugins ?? {};
	const lists = await Promise.all(
		Object.entries(plugins).map(([key, installs]) => {
			const path = installs[0]?.installPath;
			if (!path || enabled[key] !== true) return [];
			const plugin = key.split("@")[0] ?? key;
			return skillsIn(join(path, "skills"), "computer", `${plugin}:`);
		}),
	);
	return lists.flat();
}

/**
 * The skills a harness can run: the project's own first (`projectPath`, its
 * `.agents/skills`), then those for every project on this computer, each
 * group sorted by name. A name found twice keeps the first. Never throws.
 */
export async function installedSkills(
	harness: AgentHarnessName,
	{
		projectPath = null,
		home = homedir(),
	}: { projectPath?: string | null; home?: string } = {},
): Promise<InstalledSkill[]> {
	const dirs = isCustomHarness(harness)
		? [".agents/skills"]
		: HARNESS_FACTS[harness].skillDirs;
	const byName = (a: InstalledSkill, b: InstalledSkill) =>
		a.name.localeCompare(b.name);
	const [project, ...computer] = await Promise.all([
		projectPath
			? skillsIn(join(projectPath, PROJECT_SKILL_DIR), "project")
			: [],
		...dirs.map((dir) => skillsIn(join(home, dir), "computer")),
		harness === "claude-code" ? claudePluginSkills(home) : [],
	]);
	const found = new Map<string, InstalledSkill>();
	for (const skill of [
		...(project ?? []).sort(byName),
		...computer.flat().sort(byName),
	]) {
		if (!found.has(skill.name)) found.set(skill.name, skill);
	}
	return [...found.values()];
}
