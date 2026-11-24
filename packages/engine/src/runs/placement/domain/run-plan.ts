import {
	calledFlowNames,
	type Flow,
	type FlowNode,
	profileOf,
	runsAs,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { PlannedDevice, StartRunInput } from "../../../contract";
import { withComputerAgents } from "./computer-agents";
import { chooseDevices } from "./device-order";
import { namedDevice, placeNodes } from "./node-places";
import type { PlacedOn, PlanLookups, PlanOf, PlanRules } from "./plan-shapes";

/**
 * The node walk of a run's plan: where each node runs, and its profile.
 * The Placement rule is written once here: a node's profile names its
 * Device (ADR 3), else the node's `device`, else the `device` of the
 * nearest Subflow around it (a Call node's, so a folder on one computer
 * syncs there whoever starts the run), else the run's Device. Every
 * Device by its id: a name only labels it (ADR 14). The walk applies the
 * Subflow's part (`bodyGraph`). Who the Devices are (the Person's own or
 * offered, online) is the caller's: the devices' planner
 * (`PlacementPort.plan`) passes its lookups, and so does the engine's own
 * fake of a computer alone. What a Device has, and the rules of the other
 * modules, come in as functions (`PlanRules`).
 *
 * A profile is an Agent Profile for an Agent node, or a Model Profile for
 * a Decision or a Value decided by a model. A node with a cascade (ADR 6)
 * names one per tier: each tier is placed and resolved as a node of its
 * own (`runsAs`), so its tries run on its profile's Device. The run finds it on its own
 * Device, by its id: never another Device's profile of the same name.
 * When that Device is offline, the run starts from the profile as the
 * Device's document last said, and the step waits for the Device (ADR 1,
 * decision 11).
 */

const planned = (at: PlannedDevice): PlannedDevice => ({
	id: at.id,
	name: at.name,
});

/**
 * Plans a run over the Devices it may use (`PlanLookups`), in the order the
 * person sees the refusals: the run's Device (it needs a Clone of the
 * project, unless it is this computer), the flow and its called flows from
 * the flow document, then each node's Device and profile. Every Device answers
 * for its own nodes afterwards: run start checks their requirements, the
 * devices' planner an offered Device's Offers. The nodes a test run pins
 * or skips (`start.test`, ADR 27) run on no Device: the plan places
 * neither them nor the flows only they call, so a pinned Agent needs no
 * harness and no profile. The flows it returns still have them.
 */
export async function planRun<D, C>(
	start: StartRunInput,
	devices: PlanLookups<D>,
	personId: string | null,
	/** A person starts it: a Device the start names is their pick (ADR 17). */
	byPerson: boolean,
	rules: PlanRules<D, C>,
): Promise<PlanOf<D>> {
	const { walker } = devices;
	const loaded = rules.flowsForRun(await devices.flows(start.projectId), start);
	// A test run's stand-ins run on no Device (ADR 27): the plan places the
	// other nodes, and the flows only they call.
	const standIns = standInIds(start);
	const root = withoutNodes(loaded.flow, standIns);
	const calledNames = calledFrom(root, loaded.calledFlows);
	const chosen = await chooseDevices(
		[root, ...calledNames.map((name) => loaded.calledFlows[name] as Flow)],
		start,
		byPerson,
		devices,
		rules,
	);
	const { run } = chosen;
	if (run !== walker && !run.hasClone) {
		throw new Refusal(
			"conflict",
			`${run.name} does not have this project. Add its folder there first.`,
		);
	}
	if (run === walker && !walker.hasClone) {
		throw new Refusal("conflict", rules.notOnThisComputer);
	}
	const { flows, named, byId } = await placeNodes(
		await withComputerAgents(chosen.flows, calledNames, run, devices),
		run,
		devices,
		rules,
	);
	const [placed, ...called] = flows as [Flow, ...Flow[]];
	const calledByName = new Map(
		calledNames.map((name, i) => [name, called[i] as Flow]),
	);
	// The run's flow has its stand-ins again, as the flow has them.
	const flow = withNodesOf(placed, loaded.flow, standIns);
	// Each node on its Device: its profile's, else its own, else the one
	// of the Subflow it runs in (a Call node that names a computer, the
	// nearest one), else the run's. A flow that two Subflows call on two
	// Devices has its nodes in both groups: each Device checks them.
	const groups = new Map<PlacedOn<D>, Set<FlowNode>>();
	const seen = new Set<string>();
	const group = (body: Flow, key: string, around: PlacedOn<D>) => {
		if (seen.has(`${key}\u0000${around.id}`)) return;
		seen.add(`${key}\u0000${around.id}`);
		// A cascade's tiers each go to their own Device.
		for (const node of body.nodes.flatMap(runsAs)) {
			const ref = profileOf(node);
			const id = namedDevice(node);
			const at =
				ref !== undefined
					? (byId.get(ref.device) ?? run)
					: id !== undefined
						? (named.get(id) ?? run)
						: around;
			groups.set(at, (groups.get(at) ?? new Set()).add(node));
			if (node.type !== "call") continue;
			const inner = calledByName.get(node.flow);
			if (inner) group(inner, node.flow, at);
		}
	};
	group(placed, "", run);
	const offPlan = chosen.fallbacks
		? [...chosen.fallbacks.run, ...Object.values(chosen.fallbacks.nodes).flat()]
		: [];
	return {
		notes: chosen.notes,
		plan: {
			...(chosen.fallbacks ? { fallbacks: chosen.fallbacks } : {}),
			device: planned(run),
			devices: Object.fromEntries(
				[...offPlan, run, ...named.values(), ...byId.values()].map((at) => [
					at.id,
					planned(at),
				]),
			),
			personId,
		},
		run,
		flow,
		flowName: loaded.flowName,
		flowRevision: loaded.flowRevision,
		calledFlowRevisions: loaded.calledFlowRevisions,
		// A flow only a stand-in calls stays as loaded: it does not run.
		calledFlows: Object.fromEntries(
			Object.entries(loaded.calledFlows).map(([name, called]) => [
				name,
				calledByName.get(name) ?? called,
			]),
		),
		groups: [...groups].map(([at, nodes]) => ({ at, nodes: [...nodes] })),
	};
}

/** The nodes a test run's start pins or skips, by id (ADR 27). */
function standInIds(start: StartRunInput): ReadonlySet<string> {
	return new Set([
		...Object.keys(start.test?.pinned ?? {}),
		...Object.keys(start.test?.skipped ?? {}),
	]);
}

/** `flow` without the nodes of these ids: itself when there are none. */
function withoutNodes(flow: Flow, ids: ReadonlySet<string>): Flow {
	if (ids.size === 0) return flow;
	return { ...flow, nodes: flow.nodes.filter((node) => !ids.has(node.id)) };
}

/**
 * The placed flow with the nodes it left out (`ids`) back as `whole`
 * has them, in its order: itself when it left none out.
 */
function withNodesOf(
	placed: Flow,
	whole: Flow,
	ids: ReadonlySet<string>,
): Flow {
	if (ids.size === 0) return placed;
	const byId = new Map(placed.nodes.map((node) => [node.id, node]));
	return {
		...placed,
		nodes: whole.nodes.map((node) => byId.get(node.id) ?? node),
	};
}

/**
 * The names of the flows `root` calls, and the flows they call, in the
 * order of `called`: a flow only a left-out node calls is not among them.
 */
function calledFrom(root: Flow, called: Record<string, Flow>): string[] {
	const reached = new Set<string>();
	const visit = (flow: Flow) => {
		for (const node of flow.nodes) {
			// A Call's flow, and the flows of its cascade's tiers.
			const names = node.type === "call" ? calledFlowNames(node) : [];
			for (const name of names) {
				if (reached.has(name) || !Object.hasOwn(called, name)) continue;
				reached.add(name);
				visit(called[name] as Flow);
			}
		}
	};
	visit(root);
	return Object.keys(called).filter((name) => reached.has(name));
}
