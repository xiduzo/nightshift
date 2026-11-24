import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import { inMemoryConfigUsePorts } from "../adapters/out/in-memory-neighbours";
import { listProfileUse } from "./list-profile-use";

const at = {
	spaceId: "s1",
	actor: { personId: "ada", door: "session" as const },
};
const flowOf = (...nodes: unknown[]) =>
	({ nodes, inputs: [], edges: [] }) as never as Flow;
const agent = (id: string, device: string, profile: string) => ({
	id,
	type: "agent",
	connections: [],
	clis: [],
	profile: { device, profile },
});
const profile = (name: string) => ({
	name,
	harness: "claude-code" as const,
	model: "sonnet",
	permissionMode: "auto" as const,
	connections: [],
	clis: [],
});

describe("listProfileUse", () => {
	test("lists the nodes that name each profile of this Device, in the Space of the Person who asks", async () => {
		const ports = inMemoryConfigUsePorts();
		await ports.profiles.save(profile("fast"), "fast");
		await ports.profiles.save(profile("slow"), "slow");
		ports.spaces.projects = [
			{
				id: "p1",
				name: "App",
				flows: {
					night: flowOf(
						agent("plan", "d1", "fast"),
						agent("far", "d2", "slow"),
					),
				},
			},
		];
		const listed = await listProfileUse(ports)({ at });
		expect(listed.map((p) => [p.id, p.usedBy])).toEqual([
			[
				"fast",
				[
					{
						projectId: "p1",
						projectName: "App",
						flowName: "night",
						nodeIds: ["plan"],
					},
				],
			],
			["slow", []],
		]);
		expect(ports.spaces.asked).toEqual([at]);
	});
});
