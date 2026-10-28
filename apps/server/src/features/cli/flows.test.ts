import { describe, expect, test } from "bun:test";

import { flowsOptions } from "./flows";

describe("nightshift flows' arguments", () => {
	const env = { PORT: "4100" };

	test("the project of this folder, on Night Shift of this computer", () => {
		expect(flowsOptions(["list"], env, "/work/app")).toEqual({
			command: { action: "list", json: false },
			project: null,
			daemon: "http://localhost:4100",
			folder: "/work/app",
		});
	});

	test("files and --out are read from the folder the command runs in", () => {
		expect(
			flowsOptions(["save", "fix", "flows/fix.json"], env, "/work/app"),
		).toMatchObject({
			command: {
				action: "save",
				name: "fix",
				file: "/work/app/flows/fix.json",
			},
		});
		expect(
			flowsOptions(["get", "fix", "--out", "fix.json"], env, "/work/app"),
		).toMatchObject({
			command: { action: "get", name: "fix", out: "/work/app/fix.json" },
		});
	});

	test("save and import read stdin without a file, or with -", () => {
		expect(flowsOptions(["save", "fix"], env, "/w")).toMatchObject({
			command: { file: null },
		});
		expect(
			flowsOptions(["import", "-", "--name", "fix"], env, "/w"),
		).toMatchObject({ command: { action: "import", file: null, name: "fix" } });
		expect(flowsOptions(["import"], env, "/w")).toEqual({
			error: "Give the flow's name in --name to import from stdin.",
		});
	});

	test("an import takes its name from the file unless --name gives one", () => {
		expect(flowsOptions(["import", "Fix.json"], env, "/w")).toMatchObject({
			command: { action: "import", file: "/w/Fix.json", name: null },
		});
	});

	test("refuses a name that is no flow name", () => {
		expect(flowsOptions(["get", "Fix It"], env, "/w")).toEqual({
			error:
				'"Fix It" is not a flow name. Use lowercase letters, digits and -, starting with a letter or digit. Example: fix-issue.',
		});
	});

	test("refuses what it does not know", () => {
		expect(flowsOptions([], env, "/w")).toEqual({ error: "Give an action." });
		expect(flowsOptions(["remove", "fix"], env, "/w")).toEqual({
			error: "There is no action remove.",
		});
		expect(flowsOptions(["list", "--nope"], env, "/w")).toEqual({
			error: "There is no option --nope.",
		});
		expect(flowsOptions(["get", "fix", "extra"], env, "/w")).toEqual({
			error: "Too many arguments: extra.",
		});
		expect(flowsOptions(["revision", "fix"], env, "/w")).toEqual({
			error: "Give the revision's id.",
		});
		expect(flowsOptions(["list", "--project"], env, "/w")).toEqual({
			error: "--project needs a value.",
		});
	});
});
