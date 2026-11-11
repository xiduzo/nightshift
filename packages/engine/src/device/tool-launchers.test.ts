import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CliTool, SecretEnv } from "../device-config";
import { createToolLaunchers, gitEnv } from "./tool-launchers";

let root: string;
let bin: string;
let dataDir: string;
let temp: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "nightshift-launchers-"));
	bin = join(root, "bin");
	dataDir = join(root, "data");
	temp = join(root, "tmp");
	for (const dir of [bin, dataDir, temp]) {
		await Bun.write(join(dir, ".keep"), "");
	}
	// A fake gh: prints its token, HOME and arguments. As git's credential
	// helper, it answers with its token.
	await writeFile(
		join(bin, "gh"),
		[
			"#!/bin/sh",
			'if [ "$1 $2" = "auth git-credential" ]; then',
			'  [ "$3" = get ] && printf "username=x-access-token\\npassword=%s\\n" "$GH_TOKEN"',
			"  exit 0",
			"fi",
			'printf "%s|%s|%s" "${GH_TOKEN:-none}" "$HOME" "$*"',
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
	// A fake acli: its sign-in keeps the token from stdin in its HOME.
	await writeFile(
		join(bin, "acli"),
		[
			"#!/bin/sh",
			'if [ "$1" = login ]; then',
			'  token=$(cat); [ "$token" = bad ] && { echo "token $token was refused" >&2; exit 1; }',
			'  printf "%s" "$token" > "$HOME/token"; echo signed in; exit 0',
			"fi",
			'cat "$HOME/token"',
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function tool(name: string, fields: Partial<CliTool> = {}): CliTool {
	return {
		name,
		program: null,
		description: null,
		login: null,
		git: null,
		updatedAt: 1,
		...fields,
	};
}

function launchers(
	list: CliTool[],
	secrets: Record<string, string>,
	env: Record<string, string> = { PATH: "/usr/bin:/bin" },
) {
	const byName = new Map(list.map((t) => [t.name, t]));
	return createToolLaunchers({
		tools: { get: (name) => byName.get(name) ?? null, list: () => list },
		secretEnv: async (names): Promise<SecretEnv> => {
			const missing = names.filter((name) => secrets[name] === undefined);
			if (missing.length > 0) return { ok: false, missing };
			return {
				ok: true,
				env: Object.fromEntries(names.map((n) => [n, secrets[n] ?? ""])),
			};
		},
		dataDir,
		which: (program) =>
			["gh", "acli"].includes(program) ? join(bin, program) : null,
		env,
		tempDir: temp,
		now: () => 1_000,
	});
}

const run = (file: string, args: string[], env: Record<string, string> = {}) =>
	spawnSync(file, args, {
		encoding: "utf8",
		env: { PATH: "/usr/bin:/bin", ...env },
	}).stdout;

describe("prepare", () => {
	test("a tool without a login or another program needs no launcher", async () => {
		const prepared = await launchers([tool("gh")], {}).prepare(["gh"]);
		expect(prepared).toMatchObject({ ok: true, toolsPath: null, env: {} });
	});

	test("each account of a program gets a launcher with its own token", async () => {
		const tools = [
			tool("gh", { login: { env: { GH_TOKEN: "${GH_ME}" } } }),
			tool("gh-work", {
				program: "gh",
				login: { env: { GH_TOKEN: "${GH_WORK}" } },
			}),
		];
		const prepared = await launchers(tools, {
			GH_ME: "tok-me",
			GH_WORK: "tok-work",
		}).prepare(["gh", "gh-work"]);
		if (!prepared.ok) throw new Error(prepared.message);
		const folder = prepared.toolsPath ?? "";
		expect((await readdir(folder)).sort()).toEqual(["gh", "gh-work"]);
		expect((await stat(folder)).mode & 0o777).toBe(0o700);
		expect(run(join(folder, "gh-work"), ["pr", "list"])).toBe(
			"tok-work||pr list",
		);
		// The launcher named gh runs the real gh, not itself.
		expect(
			run(join(folder, "gh"), ["api"], { PATH: `${folder}:/usr/bin:/bin` }),
		).toBe("tok-me||api");
		expect(prepared.values.sort()).toEqual(["tok-me", "tok-work"]);
		await prepared.cleanup();
		await expect(stat(folder)).rejects.toThrow();
	});

	test("a secret that is not saved stops the step, and says which", async () => {
		const prepared = await launchers(
			[
				tool("gh-work", {
					program: "gh",
					login: { env: { GH_TOKEN: "${GH_WORK}" } },
				}),
			],
			{},
		).prepare(["gh-work"]);
		expect(prepared).toEqual({
			ok: false,
			message:
				"The CLI tool gh-work needs the secret GH_WORK, but it is not saved. Save it on the Secrets page, or change the tool's login.",
		});
	});

	test("a program this computer does not have stops the step", async () => {
		const prepared = await launchers(
			[tool("glab-work", { program: "glab", login: { env: { A: "b" } } })],
			{},
		).prepare(["glab-work"]);
		expect(prepared).toMatchObject({
			ok: false,
			message:
				"The CLI tool glab-work runs glab, but this computer does not have it. Install glab, or change the tool.",
		});
	});
});

describe("a login with a folder of its own", () => {
	const acli = (input = "${ACLI_WORK_TOKEN}") =>
		tool("acli-work", {
			program: "acli",
			login: {
				env: {},
				folder: "HOME",
				signIn: { command: "acli login", input },
			},
		});

	test("signs in once in its folder, with the token on stdin, and the launcher uses that folder", async () => {
		const set = launchers([acli()], { ACLI_WORK_TOKEN: "tok-1" });
		const first = await set.prepare(["acli-work"]);
		if (!first.ok) throw new Error(first.message);
		const folder = join(dataDir, "tools", "acli-work");
		expect(await readFile(join(folder, "token"), "utf8")).toBe("tok-1");
		expect((await stat(folder)).mode & 0o777).toBe(0o700);
		expect(run(join(first.toolsPath ?? "", "acli-work"), [])).toBe("tok-1");
		expect(await set.signedInAt("acli-work")).toBe(1_000);
		await first.cleanup();

		// The same values: no new sign-in.
		await writeFile(join(folder, "token"), "kept");
		const second = await set.prepare(["acli-work"]);
		if (!second.ok) throw new Error(second.message);
		expect(await readFile(join(folder, "token"), "utf8")).toBe("kept");
		await second.cleanup();
	});

	test("a changed secret signs in again", async () => {
		const folder = join(dataDir, "tools", "acli-work");
		const before = await launchers([acli()], {
			ACLI_WORK_TOKEN: "tok-1",
		}).prepare(["acli-work"]);
		if (before.ok) await before.cleanup();
		const after = await launchers([acli()], {
			ACLI_WORK_TOKEN: "tok-2",
		}).prepare(["acli-work"]);
		if (after.ok) await after.cleanup();
		expect(await readFile(join(folder, "token"), "utf8")).toBe("tok-2");
	});

	test("a failed sign-in stops the step with its output, values as •••", async () => {
		const prepared = await launchers([acli("bad")], {}).prepare(["acli-work"]);
		expect(prepared).toMatchObject({ ok: false });
		if (prepared.ok) return;
		expect(prepared.message).toBe(
			"The CLI tool acli-work could not sign in. token bad was refused Check its login under Agents → Tools, then start the run again.",
		);
	});

	test("its output masks the secret values", async () => {
		const set = launchers([acli()], { ACLI_WORK_TOKEN: "bad" });
		const result = await set.signIn("acli-work");
		expect(result).toEqual({
			ok: false,
			output: "token ••• was refused",
			signedInAt: null,
		});
	});

	test("forget removes its folder", async () => {
		const set = launchers([acli()], { ACLI_WORK_TOKEN: "tok-1" });
		const prepared = await set.prepare(["acli-work"]);
		if (prepared.ok) await prepared.cleanup();
		await set.forget("acli-work");
		await expect(stat(join(dataDir, "tools", "acli-work"))).rejects.toThrow();
	});
});

describe("git", () => {
	test("git on the tool's host asks the tool, over the helpers of git's own files", async () => {
		const prepared = await launchers(
			[
				tool("gh-work", {
					program: "gh",
					login: { env: { GH_TOKEN: "${GH_WORK}" } },
					git: { host: "github.com", helper: "auth git-credential" },
				}),
			],
			{ GH_WORK: "tok-work" },
		).prepare(["gh-work"]);
		if (!prepared.ok) throw new Error(prepared.message);
		// A helper in git's own settings that must not answer.
		const global = join(root, "gitconfig");
		await writeFile(
			global,
			'[credential]\n\thelper = "!f() { echo password=wrong; }; f"\n',
		);
		const out = spawnSync("git", ["credential", "fill"], {
			encoding: "utf8",
			input: "protocol=https\nhost=github.com\n\n",
			env: {
				PATH: `${prepared.toolsPath}:/usr/bin:/bin`,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: global,
				GIT_TERMINAL_PROMPT: "0",
				...prepared.env,
			},
		});
		expect(out.stdout).toContain("password=tok-work");
		await prepared.cleanup();
	});

	test("two tools of a step for one host: the step does not start", async () => {
		const git = { host: "github.com", helper: "auth git-credential" };
		const prepared = await launchers(
			[tool("gh", { git }), tool("gh-work", { program: "gh", git })],
			{},
		).prepare(["gh", "gh-work"]);
		expect(prepared).toMatchObject({
			ok: false,
			message:
				"Two CLI tools of this step sign in to git on github.com: gh and gh-work. Remove the git host from one of them.",
		});
	});

	test("the settings come after the ones Night Shift's environment has", () => {
		expect(
			gitEnv(
				new Map([
					["github.com", { tool: "gh", helper: "auth git-credential" }],
				]),
				() => "/tmp/t/gh",
				{ GIT_CONFIG_COUNT: "2" },
			),
		).toEqual({
			GIT_CONFIG_KEY_2: "credential.https://github.com.helper",
			GIT_CONFIG_VALUE_2: "",
			GIT_CONFIG_KEY_3: "credential.https://github.com.helper",
			GIT_CONFIG_VALUE_3: "!'/tmp/t/gh' auth git-credential",
			GIT_CONFIG_COUNT: "4",
		});
	});
});

test("guarded: the secrets that logins read", () => {
	const set = launchers(
		[
			tool("gh", { login: { env: { GH_TOKEN: "${GH_ME}", X: "plain" } } }),
			tool("acli", {
				login: {
					env: {},
					folder: "HOME",
					signIn: { command: "acli login", input: "${ACLI_TOKEN}" },
				},
			}),
			tool("jq"),
		],
		{},
	);
	expect(set.guarded()).toEqual(["ACLI_TOKEN", "GH_ME"]);
});

/** A login that keeps its sign-in in its folder, and reads `${TOKEN}`. */
const acliLogin = {
	env: {},
	folder: "HOME",
	signIn: { command: "acli login", input: "${TOKEN}" },
};

/** Launchers whose `TOKEN` is the run's Project's: one per project in `tokens`. */
function projectLaunchers(list: CliTool[], tokens: Record<string, string>) {
	return createToolLaunchers({
		tools: {
			get: (name) => list.find((t) => t.name === name) ?? null,
			list: () => list,
		},
		secretEnv: async (names, use): Promise<SecretEnv> => {
			const token = use?.run ? tokens[use.run.projectId] : undefined;
			if (token === undefined) return { ok: false, missing: [...names] };
			return {
				ok: true,
				env: Object.fromEntries(names.map((n) => [n, token])),
				fromProject: [...names],
			};
		},
		dataDir,
		which: (program) => (program === "acli" ? join(bin, program) : null),
		env: { PATH: "/usr/bin:/bin" },
		tempDir: temp,
		now: () => 1_000,
	});
}

const stepOf = (projectId: string) => ({
	spaceId: "space",
	projectId,
	runId: "run",
});

describe("a login with a Project's secret", () => {
	const list = [tool("acli-work", { program: "acli", login: acliLogin })];

	test("a command's tool signs in with the token of its run's project", async () => {
		const prepared = await projectLaunchers(list, {
			acme: "tok-acme",
		}).forCommand({ run: stepOf("acme") });
		expect(prepared.leftOut).toEqual([]);
		expect(run(join(prepared.toolsPath ?? "", "acli-work"), [])).toBe(
			"tok-acme",
		);
		expect(prepared.values).toEqual(["tok-acme"]);
		await prepared.cleanup();
	});

	test("an agent's tool does too", async () => {
		const prepared = await projectLaunchers(list, {
			acme: "tok-acme",
		}).prepare(["acli-work"], { run: stepOf("acme") });
		if (!prepared.ok) throw new Error(prepared.message);
		expect(run(join(prepared.toolsPath ?? "", "acli-work"), [])).toBe(
			"tok-acme",
		);
		await prepared.cleanup();
	});

	test("two projects at once each keep their own account", async () => {
		const tools = projectLaunchers(list, { a: "tok-a", b: "tok-b" });
		const [a, b] = await Promise.all([
			tools.forCommand({ run: stepOf("a") }),
			tools.forCommand({ run: stepOf("b") }),
		]);
		expect(run(join(a.toolsPath ?? "", "acli-work"), [])).toBe("tok-a");
		expect(run(join(b.toolsPath ?? "", "acli-work"), [])).toBe("tok-b");
		await a.cleanup();
		await b.cleanup();
	});

	test("says when it signed in per project, apart from this computer's", async () => {
		const tools = projectLaunchers(list, { a: "tok-a" });
		const prepared = await tools.forCommand({ run: stepOf("a") });
		await prepared.cleanup();
		expect(await tools.signedInAt("acli-work", "a")).toBe(1_000);
		expect(await tools.signedInAt("acli-work", "b")).toBeNull();
		expect(await tools.signedInAt("acli-work")).toBeNull();
	});

	test("forget removes the folders of its projects, not another tool's", async () => {
		const tools = projectLaunchers(list, { a: "tok-a" });
		const prepared = await tools.forCommand({ run: stepOf("a") });
		await prepared.cleanup();
		await Bun.write(join(dataDir, "tools", "acli-work-2", "keep"), "");
		await tools.forget("acli-work");
		expect(await readdir(join(dataDir, "tools"))).toEqual(["acli-work-2"]);
	});

	test("the sign-in of the tool's page says a project may keep the secret", async () => {
		const result = await projectLaunchers(list, {}).signIn("acli-work");
		expect(result.ok).toBe(false);
		expect(result.output).toContain("If a project keeps it");
	});
});

describe("forCommand", () => {
	test("a tool left out says why", async () => {
		const prepared = await launchers(
			[
				tool("gh", { login: { env: { GH_TOKEN: "${GL}" } } }),
				tool("gone", { program: "nope", login: { env: {} } }),
			],
			{},
		).forCommand();
		expect(prepared.leftOut).toEqual([
			{
				tool: "gh",
				message: expect.stringContaining("needs the secret GL"),
			},
			{
				tool: "gone",
				message: expect.stringContaining("this computer does not have it"),
			},
		]);
	});

	test("every tool with a login gets a launcher; one that cannot run is left out", async () => {
		const prepared = await launchers(
			[
				tool("gh", { login: { env: { GH_TOKEN: "${GH_ME}" } } }),
				tool("gh-plain", { program: "gh" }),
				tool("gh-work", {
					program: "gh",
					login: { env: { GH_TOKEN: "${GH_WORK}" } },
				}),
				tool("glab", { login: { env: { GITLAB_TOKEN: "${GL}" } } }),
			],
			{ GH_ME: "tok-me", GL: "tok-gl" },
		).forCommand();
		const folder = prepared.toolsPath ?? "";
		expect(await readdir(folder)).toEqual(["gh"]);
		expect(
			run(join(folder, "gh"), ["api"], { PATH: `${folder}:/usr/bin:/bin` }),
		).toBe("tok-me||api");
		expect(prepared.values).toEqual(["tok-me"]);
		await prepared.cleanup();
	});

	test("a failed sign-in leaves the tool out", async () => {
		const prepared = await launchers(
			[
				tool("acli-work", {
					program: "acli",
					login: {
						env: {},
						folder: "HOME",
						signIn: { command: "acli login", input: "bad" },
					},
				}),
			],
			{},
		).forCommand();
		expect(prepared).toMatchObject({ toolsPath: null, env: {}, values: [] });
	});

	test("two tools for one host: git keeps its own settings there", async () => {
		const git = { host: "github.com", helper: "auth git-credential" };
		const prepared = await launchers(
			[
				tool("gh", { login: { env: { GH_TOKEN: "${GH_ME}" } }, git }),
				tool("gh-work", {
					program: "gh",
					login: { env: { GH_TOKEN: "${GH_WORK}" } },
					git,
				}),
			],
			{ GH_ME: "tok-me", GH_WORK: "tok-work" },
		).forCommand();
		expect((await readdir(prepared.toolsPath ?? "")).sort()).toEqual([
			"gh",
			"gh-work",
		]);
		expect(prepared.env).toEqual({});
		await prepared.cleanup();
	});

	test("no tool with a login: nothing to prepare", async () => {
		const prepared = await launchers([tool("gh")], {}).forCommand();
		expect(prepared).toMatchObject({ toolsPath: null, env: {}, values: [] });
	});
});
