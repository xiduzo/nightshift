import { describe, expect, test } from "bun:test";
import type { AgentNode, Flow, FlowNode, ServiceNode } from "@nightshift/flows";

import type { PlacedDevice, PlannedRun } from "./peers";
import { checkServiceDevices } from "./service-devices";

/** One Device per service, with the Devices a plan placed the steps on. */

const at = { x: 0, y: 0 };
const stack = (extra: Partial<ServiceNode> = {}): ServiceNode => ({
	id: "stack",
	type: "service",
	position: at,
	start: "docker compose up -d",
	ready: { url: "http://127.0.0.1:8080" },
	...extra,
});
const fix: AgentNode = {
	id: "fix",
	type: "agent",
	position: at,
	prompt: "Fix the failing test",
	session: "fresh",
	profile: { device: "box", profile: "claude" },
};
const done: FlowNode = {
	id: "done",
	type: "end",
	position: at,
	status: "done",
};

const device = (id: string, name: string) =>
	({ id, name }) as unknown as PlacedDevice;
const macbook = device("mac", "MacBook");
const box = device("box", "hetzner-1");

function plan(
	nodes: FlowNode[],
	groups: [PlacedDevice, FlowNode[]][],
	sections: Flow["sections"] = undefined,
): PlannedRun {
	const flow: Flow = {
		version: 7,
		inputs: [],
		outputs: [],
		start: "stack",
		nodes,
		edges: [],
		...(sections ? { sections } : {}),
	};
	return {
		flow,
		calledFlows: {},
		groups: groups.map(([on, placed]) => ({ at: on, nodes: placed })),
	} as unknown as PlannedRun;
}

describe("checkServiceDevices", () => {
	test("given a step in the service's scope on another device, then run start refuses with both devices", () => {
		const service = stack();
		expect(() =>
			checkServiceDevices(
				plan(
					[service, fix, done],
					[
						[macbook, [service, done]],
						[box, [fix]],
					],
				),
			),
		).toThrow(
			'The flow runs node "fix" on hetzner-1, but the service "stack" runs on MacBook. Every step while the service runs must run on its device. Place them on the same device.',
		);
	});

	test("given every working step on the service's device, then run start goes on", () => {
		const service = stack();
		expect(() =>
			checkServiceDevices(
				plan([service, fix, done], [[box, [service, fix, done]]]),
			),
		).not.toThrow();
	});

	test("given a step on another device outside the service's Section, then run start goes on", () => {
		const service = stack({ scope: { section: "tests" } });
		expect(() =>
			checkServiceDevices(
				plan(
					[service, fix, done],
					[
						[macbook, [service, done]],
						[box, [fix]],
					],
					[{ id: "tests", label: "Tests", nodes: ["stack", "done"] }],
				),
			),
		).not.toThrow();
	});
});
