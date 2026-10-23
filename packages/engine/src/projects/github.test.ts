import { describe, expect, test } from "bun:test";

import type { GitResult, GitRunOptions } from "./git";
import { parseGitHubRepo, reposOf, systemGitHubCli } from "./github";

describe("parseGitHubRepo", () => {
	test.each([
		["acme/app", "acme", "app"],
		["  acme/app  ", "acme", "app"],
		["acme/app.git", "acme", "app"],
		["Acme-Co/my_app.js", "Acme-Co", "my_app.js"],
		["https://github.com/acme/app", "acme", "app"],
		["https://github.com/acme/app.git", "acme", "app"],
		["https://github.com/acme/app/", "acme", "app"],
		["https://www.github.com/acme/app/tree/main/src", "acme", "app"],
		["https://github.com/acme/app?tab=readme", "acme", "app"],
		["github.com/acme/app", "acme", "app"],
		["git@github.com:acme/app.git", "acme", "app"],
		["ssh://git@github.com/acme/app", "acme", "app"],
		["ssh://git@github.com:22/acme/app.git", "acme", "app"],
	])("reads %s", (input, owner, repo) => {
		expect(parseGitHubRepo(input)).toEqual({ owner, repo });
	});

	test.each([
		"",
		"acme",
		"acme/",
		"/app",
		"acme/app/extra",
		"https://gitlab.com/acme/app",
		"git@gitlab.com:acme/app.git",
		"acme/..",
		"acme/.",
		"-acme/app",
		"acme--co/app",
		"acme/app; rm -rf /",
		"acme/$(whoami)",
		"acme/app name",
		"../../etc/passwd",
		"file:///tmp/app",
		`${"a".repeat(40)}/app`,
	])("refuses %p", (input) => {
		expect(parseGitHubRepo(input)).toBeNull();
	});
});

describe("reposOf", () => {
	test("reads the name, description and visibility", () => {
		expect(
			reposOf(
				JSON.stringify([
					{ full_name: "acme/app", description: "The app", private: true },
					{ full_name: "me/notes", description: null, private: false },
					{ name: "no-full-name" },
				]),
			),
		).toEqual([
			{ name: "acme/app", description: "The app", private: true },
			{ name: "me/notes", description: null, private: false },
		]);
	});

	test("gives none for a reply that is not a list", () => {
		expect(reposOf("not json")).toEqual([]);
		expect(reposOf('{"message":"Bad credentials"}')).toEqual([]);
	});
});

describe("systemGitHubCli", () => {
	const calls: { argv: string[]; options: GitRunOptions }[] = [];
	const cli = (installed: boolean, answer: (argv: string[]) => GitResult) => {
		calls.length = 0;
		return systemGitHubCli({
			which: () => (installed ? "/usr/bin/gh" : null),
			run: async (argv, _cwd, options) => {
				calls.push({ argv, options });
				return answer(argv);
			},
		});
	};
	const ok = (stdout = ""): GitResult => ({ exitCode: 0, stdout, stderr: "" });

	test("is missing without gh, and starts nothing", async () => {
		const gh = cli(false, () => ok());
		expect(await gh.access()).toBe("missing");
		expect(await gh.repos()).toEqual([]);
		expect(calls).toEqual([]);
	});

	test("is signed in when gh auth status succeeds", async () => {
		expect(await cli(true, () => ok()).access()).toBe("signed-in");
		expect(calls[0]?.argv).toEqual([
			"gh",
			"auth",
			"status",
			"--hostname",
			"github.com",
		]);
		expect(calls[0]?.options.env?.GH_PROMPT_DISABLED).toBe("1");
	});

	test("is signed out when gh auth status fails", async () => {
		const gh = cli(true, () => ({ exitCode: 1, stdout: "", stderr: "" }));
		expect(await gh.access()).toBe("signed-out");
	});

	test("clones with an argv, never a shell line", async () => {
		const gh = cli(true, () => ok());
		await gh.clone({ owner: "acme", repo: "app" }, "/data/acme/app", "/data");
		expect(calls[0]?.argv).toEqual([
			"gh",
			"repo",
			"clone",
			"acme/app",
			"/data/acme/app",
			"--",
			"--quiet",
		]);
	});
});
