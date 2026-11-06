import {
	deviceIdOf,
	type FlowNode,
	isProfileRef,
	legacyDeviceName,
	profileOf,
} from "@nightshift/flows";
import type { Device } from "../device";
import { type StepRun, takenOverSecrets } from "../device-config";
import type { StepMove, StepPlacement } from "../graph";
import {
	type FallbackDevice,
	fallbackKey,
	type PlacedRun,
	placedRun,
	planOf,
	type RunPlan,
	type RunRow,
} from "../log";
import { deriveWorktrees } from "../read";
import { capabilitiesFor, unfit } from "./fit";
import type { PlacementPort } from "./port";

/**
 * Placement, while a run walks: where each step runs, as the run's plan
 * says, and nothing decided again. The plan was made once at the start
 * (`run-plan.ts` over `PlacementPort.plan`) and kept on the run's row;
 * this module is the one reader of it. The step runner asks it one
 * question per step (`deviceFor`), the Hand-off and the services ask for
 * a Device by id (`deviceById`), and a step whose Device went offline asks
 * it to move (`moveStep`, ADR 17). Recovery asks whether the run's
 * worktree is here (`placedHere`).
 *
 * - A node's profile names its Device (ADR 3, ADR 19), else the node's
 *   `device`, else the run's Device. A run planned before ids keeps the
 *   Devices its nodes named by name.
 * - Every Device it returns works for the run: each session, command,
 *   tool call and decider call names the run, so the Device reads that
 *   run's Project secrets for it (ADR 13).
 * - A step that moved goes on where it moved to, with the values of the
 *   fallback's profile, whether or not its first Device is back.
 * - A fallback takes a step when it is online and has what the step needs
 *   (`fit.ts`: the same check as at the start). The plan lists only
 *   fallbacks with a Clone where the node needs one.
 *
 * Who the Devices are is the port's: this computer, or another Device
 * over the Host (`PlacementPort.deviceById`). The placed Device checks
 * every call again itself.
 */

export type PlacementDeps = {
	/** This computer: a run names it by this id, or by its Walker's. */
	device: Pick<Device, "id">;
	/** The Devices of a run, by id (`PlacementPort.deviceById`). */
	devices: Pick<PlacementPort, "deviceById">;
};

/** What a node writes as its Device, as the plan keys it: the Device's id, or, for a run planned before ids, the name that plan kept (`named`). */
function nodeDevice(node: FlowNode): string | undefined {
	if (!("device" in node)) return undefined;
	return deviceIdOf(node.device) ?? legacyDeviceName(node.device) ?? undefined;
}

/** Where a step of `node` can go when its Device cannot take it, as the plan says: a node that names a Device goes by its own list, even an empty one. */
function fallbackList(
	node: FlowNode,
	plan: RunPlan,
): readonly FallbackDevice[] {
	const { fallbacks } = plan;
	if (!fallbacks) return [];
	const placesItself =
		isProfileRef(profileOf(node)) || nodeDevice(node) !== undefined;
	return placesItself
		? (fallbacks.nodes[fallbackKey(node)] ?? [])
		: fallbacks.run;
}

/** The run a step's calls name (ADR 13). */
function stepRun(row: RunRow): StepRun {
	return { spaceId: row.spaceId, projectId: row.projectId, runId: row.id };
}

/** A Device working for one run: each session, command, tool call and decider call names the run. Everything else is the Device as is. */
function forRun(device: Device, run: StepRun): Device {
	return {
		...device,
		session: (input) => device.session({ ...input, run }),
		exec: (input) => device.exec({ ...input, run }),
		callTool: (input) => device.callTool({ ...input, run }),
		// A decision or a value: the overloads take either input.
		decide: ((input: Parameters<Device["decide"]>[0]) =>
			device.decide({ ...input, run } as never)) as Device["decide"],
	};
}

/** A Device on which a step runs with the values of its own profile there (ADR 19), as the plan resolved them (`NodeFields`). The node's own values came from the Device it left. */
function withProfileValues(device: Device, fields: object): Device {
	return {
		...device,
		session: (input) =>
			device.session("offered" in input ? input : { ...input, ...fields }),
		decide: ((input: Parameters<Device["decide"]>[0]) =>
			device.decide({ ...input, ...fields } as never)) as Device["decide"],
	};
}

export function createPlacement(deps: PlacementDeps) {
	/** A Device of the run as the port reaches it, named as the plan names it, else as `name` says. */
	function deviceOf(id: string, run: PlacedRun, name?: string): Device {
		return deps.devices.deviceById(id, run, run.plan.devices[id]?.name ?? name);
	}

	/** A fallback as a step runs on it: with its profile's values, for the run. */
	function onFallback(to: FallbackDevice, run: PlacedRun, row: RunRow): Device {
		const device = deviceOf(to.id, run, to.name ?? undefined);
		return forRun(
			to.fields ? withProfileValues(device, to.fields) : device,
			stepRun(row),
		);
	}

	function deviceFor(
		node: FlowNode,
		row: RunRow,
		movedTo?: string | null,
	): Device {
		const run = placedRun(row);
		if (movedTo) {
			const to = fallbackList(node, run.plan).find((f) => f.id === movedTo);
			return onFallback(to ?? { id: movedTo, name: null }, run, row);
		}
		const ref = profileOf(node);
		if (isProfileRef(ref)) {
			return forRun(deviceOf(ref.device, run), stepRun(row));
		}
		const { plan } = run;
		const key = nodeDevice(node);
		const at =
			(key !== undefined
				? (plan.named[key] ?? plan.devices[key])
				: undefined) ?? plan.device;
		const oldName = "device" in node ? legacyDeviceName(node.device) : null;
		return forRun(
			deviceOf(at.id, run, at.name ?? oldName ?? undefined),
			stepRun(row),
		);
	}

	function deviceById(id: string, row: RunRow): Device {
		return forRun(deviceOf(id, placedRun(row)), stepRun(row));
	}

	/** Whether a Device id the log names is `device`: this computer has two ids, its own and the Walker's. */
	function isDevice(id: string, device: Device, run: PlacedRun): boolean {
		return deviceOf(id, run).id === device.id;
	}

	/** The fallbacks that can take a step of `node` now, in the plan's order, each working for the run. */
	async function fallbacksFor(node: FlowNode, row: RunRow): Promise<Device[]> {
		const run = placedRun(row);
		const fit: Device[] = [];
		for (const to of fallbackList(node, run.plan)) {
			const device = deviceOf(to.id, run, to.name ?? undefined);
			const asThere = { ...node, ...to.fields } as FlowNode;
			const why = await unfit(
				{
					name: device.name,
					offline: !(await device.state()).online,
					// The plan lists a fallback with a Clone where the node needs one.
					hasClone: true,
				},
				[asThere],
				() => capabilitiesFor([asThere], device).catch(() => null),
			);
			if (why !== null) continue;
			fit.push(onFallback(to, run, row));
		}
		return fit;
	}

	async function moveStep(input: StepMove): Promise<Device | null> {
		const { log, node, run: row, stepId, from } = input;
		// A session lives on its Device.
		if (input.hasSession) return null;
		const run = placedRun(row);
		const { holder } = deriveWorktrees(await log.state(row.id), row);
		// The run's work is only on an offline Device: the step would go on without it.
		const holderOnline =
			!input.inWorktree || (await deviceOf(holder, run).state()).online;
		for (const to of await fallbacksFor(node, row)) {
			if (!holderOnline && !isDevice(holder, to, run)) continue;
			await log.append({
				type: "StepMoved",
				runId: row.id,
				stepId,
				payload: { from: from.id, to: to.id },
			});
			await log.append({
				type: "RunWarned",
				runId: row.id,
				stepId,
				payload: {
					kind: "device-fallback",
					message: `${from.name} is offline. ${to.name} takes over this step. ${takenOverSecrets({ host: to.id === run.plan.fallbacks?.hostId })}`,
				},
			});
			return to;
		}
		return null;
	}

	/** Whether a run's own worktree is on this computer, as its plan says. */
	function placedHere(row: RunRow): boolean {
		const at = planOf(row).device.id;
		return at === deps.device.id || at === row.walkerId;
	}

	const placement: StepPlacement & { placedHere: typeof placedHere } = {
		deviceFor,
		deviceById,
		moveStep,
		placedHere,
	};
	return placement;
}
