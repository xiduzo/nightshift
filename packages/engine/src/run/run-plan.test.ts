import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	type FlowNode,
	type ProfileRef,
} from "@nightshift/flows";
import type { Device } from "../device";
import type { PlacedDevice } from "./peers";
import { type PlanDevices, planNodes, UNREACHABLE_DEVICE } from "./run-plan";

/**
 * The node walk of a run's plan, over Devices a test gives it: the
 * Placement rule (a node's profile's Device, else its `device`, else the
 * run's) and the refusals of a Device nobody has. Who the Devices are is
 * the caller's: the devices' planner, or the engine's fake of a computer
 * alone, which therefore words no refusal of its own.
 */

const PROFILE = {
	harness: "claude-code" as const,
	model: "sonnet",
	permissionMode: "auto" as const,
	clis: [],
	connections: [],
};

/** A Device with the profiles it has, and a Clone of the project or not. */
function at(
	id: string,
	options: {
		thisDevice?: boolean;
		hasClone?: boolean;
		profiles?: string[];
		offline?: boolean;
	} = {},
): PlacedDevice {
	const profiles = options.profiles ?? [];
	const device = {
		id,
		name: id,
		flows: async () => ({}),
		capabilities: async (query: { profiles?: string[] }) => {
			if (options.offline) throw new Error(`${id} is offline.`);
			return {
				profiles: Object.fromEntries(
					(query.profiles ?? [])
						.filter((name) => profiles.includes(name))
						.map((name) => [name, PROFILE]),
				),
			};
		},
	} as unknown as Device;
	return {
		device,
		id,
		name: id,
		thisDevice: options.thisDevice ?? false,
		hasClone: options.hasClone ?? true,
		...(options.offline ? { offline: true } : {}),
	};
}

const flow = (nodes: FlowNode[]): Flow =>
	({
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "a",
		nodes,
		edges: nodes.slice(1).map((node, i) => ({
			id: `e${i}`,
			from: nodes[i]?.id ?? "",
			outcome: "pass",
			to: node.id,
		})),
	}) as Flow;

const command = (id: string, device?: string) =>
	({
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: "true",
		output: "text",
		...(device ? { device } : {}),
	}) as FlowNode;

const profiled = (id: string, profile: ProfileRef) =>
	({
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: "Work.",
		profile,
	}) as FlowNode;

/** This computer, `studio`, and `hetzner-1`: the Person's Devices. */
function devices(walkerProfiles: string[] = []): PlanDevices {
	const walker = at("this", { thisDevice: true, profiles: walkerProfiles });
	const others = [at("studio", { profiles: ["everywhere"] }), at("hetzner-1")];
	return {
		walker,
		byId: async (id) =>
			id === "this" ? walker : (others.find((d) => d.id === id) ?? null),
		byName: async (name) =>
			name === "this" ? walker : (others.find((d) => d.name === name) ?? null),
		profileDevice: async (id) =>
			id === "this" ? walker : (others.find((d) => d.id === id) ?? null),
		profileFor: (id) => (walkerProfiles.includes(id) ? PROFILE : null),
		flows: async () => ({}),
	};
}

describe("the node walk of a run's plan", () => {
	test("places each node: its device, else the run's; the plan names them and the Person", async () => {
		const planned = await planNodes(
			{
				projectId: "p",
				deviceId: "studio",
				flow: flow([command("here"), command("there", "hetzner-1")]),
			},
			devices(),
			"the-person",
		);
		expect(planned.plan).toEqual({
			device: { id: "studio", name: "studio" },
			named: { "hetzner-1": { id: "hetzner-1", name: "hetzner-1" } },
			personId: "the-person",
		});
		expect(planned.run.id).toBe("studio");
		expect(
			planned.groups.map((g) => [g.at.id, g.nodes.map((n) => n.id)]),
		).toEqual([
			["studio", ["here"]],
			["hetzner-1", ["there"]],
		]);
	});

	test("a node's profile names its Device: the node runs there with the profile's settings, named so in the run's copy", async () => {
		const planned = await planNodes(
			{
				projectId: "p",
				flow: flow([
					profiled("there", { device: "studio", profile: "everywhere" }),
					profiled("here", { device: "this", profile: "here_only" }),
				]),
			},
			devices(["here_only"]),
			"the-person",
		);
		expect(planned.plan.named).toEqual({
			studio: { id: "studio", name: "studio" },
			this: { id: "this", name: "this" },
		});
		expect(planned.flow.nodes).toMatchObject([
			{ id: "there", device: "studio", model: "sonnet" },
			{ id: "here", device: "this", model: "sonnet" },
		]);
		expect(
			planned.groups.map((g) => [g.at.id, g.nodes.map((n) => n.id)]),
		).toEqual([
			["studio", ["there"]],
			["this", ["here"]],
		]);
	});

	test("never another Device's profile of the same name: a profile its Device lacks refuses the run", async () => {
		await expect(
			planNodes(
				{
					projectId: "p",
					flow: flow([
						profiled("deliver", { device: "hetzner-1", profile: "everywhere" }),
					]),
				},
				devices(["everywhere"]),
				"the-person",
			),
		).rejects.toThrow(
			'The flow uses the profile "everywhere" on hetzner-1, but hetzner-1 has no such profile (deliver). Pick another profile.',
		);
	});

	test("a profile of a device the Space no longer has refuses the run", async () => {
		await expect(
			planNodes(
				{
					projectId: "p",
					flow: flow([
						profiled("deliver", { device: "sold", profile: "p-1234" }),
					]),
				},
				devices(),
				"the-person",
			),
		).rejects.toThrow(
			"The flow uses a profile of a device that is no longer in this Space (deliver). Pick another profile.",
		);
	});

	test("a node's Device that is offline is not asked, and a profile on it is refused", async () => {
		const away = at("away", { offline: true });
		const offline: PlanDevices = {
			...devices(),
			byName: async (name) => (name === "away" ? away : null),
			profileDevice: async (id) => (id === "away" ? away : null),
		};
		const planned = await planNodes(
			{ projectId: "p", flow: flow([command("plain", "away")]) },
			offline,
			"the-person",
		);
		expect(planned.groups.map((g) => [g.at.id, g.at.offline])).toEqual([
			["away", true],
		]);
		await expect(
			planNodes(
				{
					projectId: "p",
					flow: flow([profiled("work", { device: "away", profile: "own" })]),
				},
				offline,
				"the-person",
			),
		).rejects.toThrow(
			'away is offline, so Night Shift cannot find its profile for "work". Start the run when it is online.',
		);
	});

	test("refuses a Device nobody can reach, a name nobody has, and a run's Device without the project", async () => {
		await expect(
			planNodes(
				{ projectId: "p", deviceId: "gone", flow: flow([command("a")]) },
				devices(),
				"the-person",
			),
		).rejects.toThrow(UNREACHABLE_DEVICE);
		await expect(
			planNodes(
				{ projectId: "p", flow: flow([command("a", "nowhere")]) },
				devices(),
				"the-person",
			),
		).rejects.toThrow(
			'The flow names the device "nowhere", but you have no device of that name',
		);
		const bare = devices();
		await expect(
			planNodes(
				{ projectId: "p", deviceId: "bare", flow: flow([command("a")]) },
				{
					...bare,
					byId: async () => at("bare", { hasClone: false }),
				},
				"the-person",
			),
		).rejects.toThrow("bare does not have this project.");
	});
});
