import { describe, expect, test } from "bun:test";
import type { CliTool } from "@/shared/api";
import { newRow } from "./connections/key-value-rows";
import {
	gitOf,
	loginDraftOf,
	loginOf,
	loginPreset,
	loginProblem,
} from "./tool-login-draft";

const tool = (fields: Partial<CliTool> = {}): CliTool => ({
	name: "acli-dimpact",
	program: "acli",
	description: null,
	login: null,
	git: null,
	updatedAt: 1,
	usedBy: [],
	profiles: [],
	signedInAt: null,
	...fields,
});

describe("the login draft", () => {
	test("a tool without a login gives an empty draft, and saves none", () => {
		const draft = loginDraftOf(tool());
		expect(loginOf(draft)).toBeUndefined();
		expect(gitOf(draft)).toBeUndefined();
	});

	test("a saved login comes back as it was", () => {
		const login = {
			env: { SITE: "dimpact" },
			folder: "HOME",
			signIn: { command: "acli jira auth login --token", input: "${T}" },
		};
		const draft = loginDraftOf(
			tool({ login, git: { host: "github.com", helper: "x" } }),
		);
		expect(loginOf(draft)).toEqual(login);
		expect(gitOf(draft)).toEqual({ host: "github.com" });
	});

	test("a sign-in without its own folder is not saved", () => {
		const draft = {
			...loginDraftOf(null),
			env: [newRow("GH_TOKEN", "${GH}")],
			signInCommand: "gh auth login",
		};
		expect(loginOf(draft)).toEqual({ env: { GH_TOKEN: "${GH}" } });
	});

	test("a variable name or folder variable that a shell cannot read is a problem", () => {
		expect(
			loginProblem({ ...loginDraftOf(null), env: [newRow("GH TOKEN", "x")] }),
		).toStartWith("GH TOKEN is not a variable name.");
		expect(
			loginProblem({ ...loginDraftOf(null), ownFolder: true, folder: "" }),
		).toStartWith("Give the variable");
		expect(loginProblem(loginDraftOf(null))).toBeNull();
	});
});

describe("the usual logins", () => {
	test("gh: a token named after the tool, and git on github.com", () => {
		const preset = loginPreset("gh", "gh-work");
		expect(preset?.env?.map((row) => [row.key, row.value])).toEqual([
			["GH_TOKEN", "${GH_WORK_TOKEN}"],
		]);
		expect(preset?.gitHost).toBe("github.com");
	});

	test("acli: its own folder in HOME and a sign-in that reads the token as input", () => {
		expect(loginPreset("acli", "acli-dimpact")).toMatchObject({
			ownFolder: true,
			folder: "HOME",
			signInInput: "${ACLI_DIMPACT_TOKEN}",
		});
	});

	test("a program Night Shift does not know has none", () => {
		expect(loginPreset("jq", "jq")).toBeNull();
	});
});
