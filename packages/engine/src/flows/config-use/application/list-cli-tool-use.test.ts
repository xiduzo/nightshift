import { describe, expect, test } from "bun:test";
import type { CliTool } from "../../../settings";
import { inMemoryConfigUsePorts } from "../adapters/out/in-memory-neighbours";
import { listCliToolUse } from "./list-cli-tool-use";

const at = { spaceId: "s1", personId: "ada" };
const tool = (name: string, secrets: string[], signIn = false): CliTool => ({
	name,
	program: null,
	description: null,
	login: {
		env: Object.fromEntries(secrets.map((s) => [s, `\${${s}}`])),
		...(signIn ? { signIn: { command: "login" } } : {}),
	} as never,
	git: null,
	updatedAt: 0,
});

describe("listCliToolUse", () => {
	test("a login whose secrets are here signs in here", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.cliTools.tools = [tool("aws", ["AWS_KEY"], true)];
		ports.connections.saved = ["AWS_KEY"];
		ports.toolLaunchers.at = { aws: 5 };
		const [aws] = await listCliToolUse(ports)({ at });
		expect(aws?.signedInAt).toBe(5);
		expect(aws?.loginState).toEqual({
			signsInHere: true,
			projects: [],
			missing: [],
		});
	});

	test("names the project that keeps the values this computer does not have", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.cliTools.tools = [tool("aws", ["AWS_KEY"], true)];
		ports.spaces.projects = [{ id: "p1", name: "App", flows: {} }];
		ports.connections.shared = { p1: ["AWS_KEY"] };
		ports.toolLaunchers.at = { "aws/p1": 7 };
		const [aws] = await listCliToolUse(ports)({ at });
		expect(aws?.loginState).toEqual({
			signsInHere: false,
			projects: [{ projectId: "p1", projectName: "App", signedInAt: 7 }],
			missing: [],
		});
	});

	test("a secret no one keeps is missing", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.cliTools.tools = [tool("aws", ["AWS_KEY"])];
		const [aws] = await listCliToolUse(ports)({ at });
		expect(aws?.loginState?.missing).toEqual(["AWS_KEY"]);
		expect(aws?.signedInAt).toBeNull();
	});
});
