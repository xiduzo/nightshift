import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedSkills } from "./skills";

let home: string;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "nightshift-skills-"));
});

afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

async function skill(dir: string, name: string, text: string) {
	await mkdir(join(home, dir, name), { recursive: true });
	await writeFile(join(home, dir, name, "SKILL.md"), text);
}

async function json(path: string, value: unknown) {
	await mkdir(join(home, path, ".."), { recursive: true });
	await writeFile(join(home, path), JSON.stringify(value));
}

describe("installedSkills", () => {
	test("reads the name and description of each SKILL.md", async () => {
		await skill(
			".claude/skills",
			"tdd",
			"---\nname: tdd\ndescription: Test-driven\n  development.\n---\nBody",
		);
		await skill(".claude/skills", "bare", "No frontmatter");
		await mkdir(join(home, ".claude/skills/references"), { recursive: true });

		expect(await installedSkills("claude-code", { home })).toEqual([
			{ name: "bare", description: null, source: "computer" },
			{
				name: "tdd",
				description: "Test-driven development.",
				source: "computer",
			},
		]);
	});

	test("each harness reads its own folders and the shared one", async () => {
		await skill(".claude/skills", "claude-only", "---\nname: claude-only\n---");
		await skill(".codex/skills", "codex-only", "---\nname: codex-only\n---");
		await skill(".agents/skills", "shared", "---\nname: shared\n---");

		const names = async (harness: Parameters<typeof installedSkills>[0]) =>
			(await installedSkills(harness, { home })).map((s) => s.name);
		expect(await names("claude-code")).toEqual(["claude-only"]);
		expect(await names("codex")).toEqual(["codex-only", "shared"]);
		expect(await names("acp:goose")).toEqual(["shared"]);
	});

	test("a Claude Code plugin that is on adds its skills as plugin:skill", async () => {
		const on = join(home, "plugins/figma");
		const off = join(home, "plugins/brag");
		await skill(
			"plugins/figma/skills",
			"figma-use",
			"---\nname: figma-use\n---",
		);
		await skill("plugins/brag/skills", "brag", "---\nname: brag\n---");
		await json(".claude/plugins/installed_plugins.json", {
			plugins: {
				"figma@official": [{ installPath: on }],
				"brag@brag": [{ installPath: off }],
			},
		});
		await json(".claude/settings.json", {
			enabledPlugins: { "figma@official": true, "brag@brag": false },
		});

		expect(await installedSkills("claude-code", { home })).toEqual([
			{ name: "figma:figma-use", description: null, source: "computer" },
		]);
	});

	test("the project's own skills come first, and win over a skill of the same name", async () => {
		const project = join(home, "project");
		await skill("project/.agents/skills", "release", "---\nname: release\n---");
		await skill("project/.agents/skills", "tdd", "---\nname: tdd\n---");
		await skill(".claude/skills", "tdd", "---\nname: tdd\n---");
		await skill(".claude/skills", "audit", "---\nname: audit\n---");

		const skills = await installedSkills("claude-code", {
			home,
			projectPath: project,
		});
		expect(skills.map((s) => [s.name, s.source])).toEqual([
			["release", "project"],
			["tdd", "project"],
			["audit", "computer"],
		]);
	});

	test("a project skill may be a link to the skill elsewhere", async () => {
		await skill("shared", "lint", "---\nname: lint\n---");
		await mkdir(join(home, "project/.agents/skills"), { recursive: true });
		await symlink(
			join(home, "shared/lint"),
			join(home, "project/.agents/skills/lint"),
		);

		const skills = await installedSkills("codex", {
			home,
			projectPath: join(home, "project"),
		});
		expect(skills).toEqual([
			{ name: "lint", description: null, source: "project" },
		]);
	});

	test("no folders give no skills", async () => {
		expect(await installedSkills("opencode", { home })).toEqual([]);
	});
});
