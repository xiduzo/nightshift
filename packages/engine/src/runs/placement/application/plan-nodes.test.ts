import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowNode } from "@nightshift/flows";
import { NotOnThisComputer } from "../../../contract";
import type { Device } from "../../../device";
import { inMemoryDeviceFit } from "../adapters/out/in-memory-neighbours";
import type { PlacedDevice, PlanDevices } from "./plan-nodes";
import { planNodes } from "./plan-nodes";

/**
 * The plan of a run over the twin of the fit check: the use case binds the
 * node walk to the flows of the run and the words of a move. The node
 * walk itself is tested over real Devices beside the slice (`run-plan.test.ts`).
 */

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

const command = (id: string) =>
	({
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: "true",
		stdout: "text",
	}) as FlowNode;

function at(
	id: string,
	options: { thisDevice?: boolean; hasClone?: boolean } = {},
): PlacedDevice {
	return {
		device: { id, name: id } as Device,
		id,
		name: id,
		thisDevice: options.thisDevice ?? false,
		hasClone: options.hasClone ?? true,
	};
}

function devicesOf(walker: PlacedDevice, others: PlacedDevice[]): PlanDevices {
	const all = [walker, ...others];
	const find = async (id: string) => all.find((d) => d.id === id) ?? null;
	return {
		walker,
		byId: find,
		nodeDevice: find,
		profileFor: () => null,
		flows: async () => ({}),
	};
}

describe("plan nodes", () => {
	test("plans the run on this computer when it fits, and names the Person", async () => {
		const fit = inMemoryDeviceFit();
		const plan = planNodes({ fit });
		const walker = at("this", { thisDevice: true });

		const planned = await plan(
			{ projectId: "p", flow: flow([command("a")]) },
			devicesOf(walker, []),
			"ada",
		);

		expect(planned.run).toBe(walker);
		expect(planned.plan).toMatchObject({
			device: { id: "this", name: "this" },
			personId: "ada",
		});
		expect(planned.notes).toEqual([]);
		expect(fit.asked).toEqual([
			{ kind: "unfit", device: "this" },
			{ kind: "capabilities", device: "this" },
		]);
	});

	test("refuses a run whose project is not on this computer", async () => {
		const plan = planNodes({ fit: inMemoryDeviceFit() });
		const walker = at("this", { thisDevice: true, hasClone: false });

		const refused = await plan(
			{ projectId: "p", flow: flow([command("a")]) },
			devicesOf(walker, []),
			"ada",
		).catch((error: unknown) => error);

		expect(refused).toBeInstanceOf(NotOnThisComputer);
		expect(refused).toMatchObject({
			kind: "conflict",
			message:
				"This project is not on this computer. Add its folder here to use it.",
		});
	});

	test("a Device that cannot take the run passes it on, and the note names the secrets that work", async () => {
		const fit = inMemoryDeviceFit();
		fit.setDevice("studio", { unfit: "no harness" });
		const plan = planNodes({ fit });
		const walker = at("this", { thisDevice: true });

		const planned = await plan(
			{ projectId: "p", deviceId: "studio", flow: flow([command("a")]) },
			devicesOf(walker, [at("studio")]),
			"ada",
		);

		expect(planned.run).toBe(walker);
		expect(planned.notes).toEqual([
			"studio: no harness. this takes over the run. Space and project secrets work there. Secrets saved only on another computer do not.",
		]);
	});
});
