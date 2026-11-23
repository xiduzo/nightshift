import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import type { Connection } from "../../../device-config";
import { inMemoryConfigUsePorts } from "../adapters/out/in-memory-neighbours";
import { listConnectionUse } from "./list-connection-use";

const at = { spaceId: "s1", personId: "ada" };
const flowOf = (...nodes: unknown[]) =>
	({ nodes, inputs: [], edges: [] }) as never as Flow;
const connection = (name: string, ...secrets: string[]) =>
	({
		name,
		description: null,
		variables: secrets.map((secret) => ({ name: secret, source: "missing" })),
		updatedAt: 0,
	}) as never as Connection;
const ref = { projectId: "p1", projectName: "App", flowName: "night" };

describe("listConnectionUse", () => {
	test("lists the flows that name each connection, and the secrets they read here", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.connections.connections = [connection("gh", "GH_TOKEN")];
		ports.spaces.projects = [
			{
				id: "p1",
				name: "App",
				flows: {
					night: flowOf({
						id: "plan",
						type: "agent",
						connections: ["gh"],
						clis: [],
					}),
				},
			},
		];
		const listed = await listConnectionUse(ports)({ at });
		expect(listed.connections.map((c) => [c.name, c.usedBy])).toEqual([
			["gh", [ref]],
		]);
		expect(
			listed.secrets.map((s) => [s.name, s.usedBy, s.flows, s.tools]),
		).toEqual([["GH_TOKEN", ["gh"], [ref], []]]);
		expect(listed.personal).toBe("available");
	});

	test("leaves out a flow whose project has the secret", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.connections.saved = ["API_KEY"];
		ports.connections.shared = { p1: ["API_KEY"] };
		ports.spaces.projects = [
			{
				id: "p1",
				name: "App",
				flows: {
					night: flowOf({ id: "call", type: "command", secrets: ["API_KEY"] }),
				},
			},
		];
		const listed = await listConnectionUse(ports)({ at });
		expect(listed.secrets.map((s) => [s.name, s.flows])).toEqual([
			["API_KEY", []],
		]);
	});
});
