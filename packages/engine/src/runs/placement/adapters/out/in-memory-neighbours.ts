import type { FlowNode, ProfileSettings } from "@nightshift/flows";
import type { Capabilities, Device } from "../../../../device";
import type { PlanInput, PlannedRun } from "../../application/plan-nodes";
import type { DeviceFit, PlacementPort } from "../../application/ports";

/**
 * The twins of the ports another module fills: the fit check and what a
 * Device has (`DeviceFit`, the engine's wire), and the devices' planner
 * (`PlacementPort`, `@nightshift/devices`). Each records what it was asked.
 */

/** What a test sets of a Device, by its id. */
export type FitAnswers = {
	/** Why the Device cannot take the nodes. Absent: it can. */
	unfit?: string;
	/** Its profiles, by id. */
	profiles?: Record<string, ProfileSettings>;
	/** Whether each address answers, by its key. */
	addresses?: Record<string, string | null>;
};

/**
 * The fit check over answers a test sets per Device (`setDevice`). A
 * Device is known by its `id`. A node of type `agent` or `command` works
 * in the worktree, as the real kinds say.
 */
export function inMemoryDeviceFit(): DeviceFit & {
	setDevice(id: string, answers: FitAnswers): void;
	asked: { kind: string; device: string }[];
} {
	const answers = new Map<string, FitAnswers>();
	const asked: { kind: string; device: string }[] = [];
	const idOf = (device: Device) => device.id;
	const of = (device: Device) => answers.get(idOf(device)) ?? {};
	return {
		asked,
		setDevice: (id, set) => answers.set(id, set),
		capabilitiesFor: async (_nodes, device) => {
			asked.push({ kind: "capabilities", device: idOf(device) });
			return { profiles: of(device).profiles ?? {} } as Capabilities;
		},
		unfit: async (at, _nodes, has) => {
			asked.push({ kind: "unfit", device: at.id });
			if (at.offline) return `${at.name} is offline`;
			if (at.offered) return null;
			if ((await has()) === null) return `${at.name} cannot be reached`;
			const why = answers.get(at.id)?.unfit;
			return why === undefined ? null : `${at.name}: ${why}`;
		},
		works: (node: FlowNode) =>
			node.type === "agent" || node.type === "command" ? "worktree" : null,
		profilesOn: async (device, ids) => {
			asked.push({ kind: "profiles", device: idOf(device) });
			const profiles = of(device).profiles ?? {};
			return Object.fromEntries(
				ids.flatMap((id) => (profiles[id] ? [[id, profiles[id]]] : [])),
			);
		},
		addressesOn: async (device) => {
			asked.push({ kind: "addresses", device: idOf(device) });
			return of(device).addresses;
		},
		addressKey: (check) => `${check.decider} ${check.address.baseUrl}`,
	};
}

/**
 * The devices' planner over a plan a test sets (`setPlan`): it records
 * each request, and refuses what it is not given.
 */
export function inMemoryPlacementPort(): PlacementPort & {
	setPlan(plan: PlannedRun): void;
	setDevice(device: Device): void;
	plans: PlanInput[];
} {
	let planned: PlannedRun | null = null;
	const devices = new Map<string, Device>();
	const plans: PlanInput[] = [];
	return {
		plans,
		setPlan: (plan) => {
			planned = plan;
		},
		setDevice: (device) => devices.set(device.id, device),
		plan: async (input) => {
			plans.push(input);
			if (!planned) throw new Error("No plan was set.");
			return planned;
		},
		deviceById: (id) => {
			const device = devices.get(id);
			if (!device) throw new Error(`No Device ${id} was set.`);
			return device;
		},
		moveTo: async (_run, _actor, to) => {
			const device = devices.get(to);
			return device ? { id: device.id, name: device.name } : null;
		},
		devicesFor: async () => [],
		placements: async () => [],
	};
}
