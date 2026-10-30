import { describe, expect, test } from "bun:test";
import type { FlowNode } from "../flow";
import { type CliToolRef, programsWithoutLogin } from "./cli-programs";
import { commandNode } from "./nodes";

const dimpact: CliToolRef = {
	name: "acli-dimpact",
	program: "acli",
	signsIn: true,
};

const command = (text: string): FlowNode => ({
	...commandNode("list", { x: 0, y: 0 }),
	command: text,
});

const programs = (text: string, tools: CliToolRef[] = [dimpact]) =>
	programsWithoutLogin(command(text), tools).map((found) => found.program);

describe("programsWithoutLogin", () => {
	test("a program called by its own name, with its login only under another name", () => {
		expect(
			programsWithoutLogin(command("acli jira workitem search"), [dimpact]),
		).toEqual([{ program: "acli", tools: ["acli-dimpact"] }]);
	});

	test("finds the call where the shell runs it", () => {
		for (const text of [
			"set -e\nlist=$(acli jira workitem search \\\n\t--json)",
			"echo x | acli jira",
			"true && acli jira",
			"(acli jira)",
			"`acli jira`",
			"if acli jira auth status; then echo ok; fi",
			"ACLI_DEBUG=1 acli jira",
			"  acli",
		]) {
			expect(programs(text)).toEqual(["acli"]);
		}
	});

	test("the tool's own name, a path, a word in text or a comment is no call", () => {
		for (const text of [
			"acli-dimpact jira workitem search",
			'"{{vars.jira_tool}}" jira workitem search',
			"/usr/local/bin/acli jira",
			"echo 'run acli later'",
			"# acli jira workitem search",
			"jq . # then acli",
			"cat acli.json",
		]) {
			expect(programs(text)).toEqual([]);
		}
	});

	test("a tool named after its program signs it in", () => {
		const plain: CliToolRef = { name: "acli", program: null, signsIn: true };
		expect(programs("acli jira", [dimpact, plain])).toEqual([]);
	});

	test("a tool without a login does not count", () => {
		const unsigned: CliToolRef = { ...dimpact, signsIn: false };
		expect(programs("acli jira", [unsigned])).toEqual([]);
	});

	test("names every tool that signs in to the program", () => {
		const info: CliToolRef = { ...dimpact, name: "acli-info" };
		expect(programsWithoutLogin(command("acli jira"), [info, dimpact])).toEqual(
			[{ program: "acli", tools: ["acli-dimpact", "acli-info"] }],
		);
	});

	test("reads the command a Wait runs", () => {
		const wait: FlowNode = {
			id: "wait",
			type: "wait",
			position: { x: 0, y: 0 },
			until: {
				kind: "command",
				command: "acli jira workitem view",
				everyMinutes: 5,
			},
		};
		expect(programsWithoutLogin(wait, [dimpact])).toHaveLength(1);
	});
});
