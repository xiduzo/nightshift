import { describe, expect, test } from "bun:test";
import type { FlowNode } from "../flow";
import { commandNode } from "../nodes/command";
import { type CliToolRef, programsWithoutLogin } from "./cli-programs";

const work: CliToolRef = {
	name: "acli-work",
	program: "acli",
	signsIn: true,
};

const command = (text: string): FlowNode => ({
	...commandNode("list", { x: 0, y: 0 }),
	command: text,
});

const programs = (text: string, tools: CliToolRef[] = [work]) =>
	programsWithoutLogin(command(text), tools).map((found) => found.program);

describe("programsWithoutLogin", () => {
	test("a program called by its own name, with its login only under another name", () => {
		expect(
			programsWithoutLogin(command("acli jira workitem search"), [work]),
		).toEqual([{ program: "acli", tools: ["acli-work"] }]);
	});

	test("finds the call where the shell runs it", () => {
		for (const text of [
			"set -e\nlist=$(acli jira workitem search \\\n\t--json)",
			"echo x | acli jira",
			"true && acli jira",
			"(acli jira)",
			"`acli jira`",
			"if acli jira auth status; then echo ok; fi",
			"if ! acli jira auth status; then exit 1; fi",
			"ACLI_DEBUG=1 acli jira",
			"  acli",
		]) {
			expect(programs(text)).toEqual(["acli"]);
		}
	});

	test("the tool's own name, a path, a word in text or a comment is no call", () => {
		for (const text of [
			"acli-work jira workitem search",
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
		expect(programs("acli jira", [work, plain])).toEqual([]);
	});

	test("a tool without a login does not count", () => {
		const unsigned: CliToolRef = { ...work, signsIn: false };
		expect(programs("acli jira", [unsigned])).toEqual([]);
	});

	test("names every tool that signs in to the program", () => {
		const second: CliToolRef = { ...work, name: "acli-work-2" };
		expect(programsWithoutLogin(command("acli jira"), [second, work])).toEqual([
			{ program: "acli", tools: ["acli-work", "acli-work-2"] },
		]);
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
		expect(programsWithoutLogin(wait, [work])).toHaveLength(1);
	});
});
