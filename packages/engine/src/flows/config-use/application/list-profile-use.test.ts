import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import type { ProfileView } from "../../../device-config";
import { inMemoryConfigUsePorts } from "../adapters/out/in-memory-neighbours";
import { listProfileUse } from "./list-profile-use";

const at = { spaceId: "s1", personId: "ada" };
const flowOf = (...nodes: unknown[]) =>
	({ nodes, inputs: [], edges: [] }) as never as Flow;
const agent = (id: string, device: string, profile: string) => ({
	id,
	type: "agent",
	connections: [],
	clis: [],
	profile: { device, profile },
});
const profile = (id: string) =>
	({
		id,
		name: id,
		harness: "claude-code",
		connections: [],
		clis: [],
	}) as never as ProfileView;

describe("listProfileUse", () => {
	test("lists the nodes that name each profile of this Device, in the Space of the Person who asks", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.profiles.profiles = [profile("fast"), profile("slow")];
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
