import {
	cascadeProblem,
	type Flow,
	type FlowNode,
	hasCascade,
	type ProfileRef,
	type ProfileSettings,
	profileOf,
	resolveNodeProfile,
	runsAs,
	tierUsers,
	withTierNode,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { PlacedOn, PlanLookups, PlanRules } from "./plan-shapes";
import { checkAddresses } from "./start-addresses";

/**
 * Where each node of a run's flows runs, and its profile: the node walk of
 * the plan (`run-plan.ts`), after the order chose the Devices
 * (`device-order.ts`).
 */

/** The Device a node names by its id, if its kind runs on one. */
export function namedDevice(node: FlowNode): string | undefined {
	return "device" in node ? node.device : undefined;
}

/**
 * Where each node runs, and its profile. Returns the flows with their
 * profiles resolved, the Devices the nodes name (`named`), and the Devices
 * of the profiles (`byId`), each by its id: a node with a profile runs on
 * its profile's Device, so two Devices of one name never take each
 * other's steps.
 */
export async function placeNodes<D>(
	flows: readonly Flow[],
	runDevice: PlacedOn<D>,
	devices: PlanLookups<D>,
	rules: Pick<
		PlanRules<D, unknown>,
		"profilesOn" | "addressesOn" | "addressKey"
	>,
): Promise<{
	flows: Flow[];
	named: Map<string, PlacedOn<D>>;
	byId: Map<string, PlacedOn<D>>;
}> {
	// A cascade's tiers each name their own profile.
	const nodes = flows.flatMap((f) => f.nodes.flatMap(runsAs));
	const named = new Map<string, PlacedOn<D>>();
	const byId = new Map<string, PlacedOn<D>>();
	const unknown = new Map<string, string[]>();
	for (const node of nodes) {
		if (profileOf(node) !== undefined) continue;
		const id = namedDevice(node);
		if (id === undefined || named.has(id)) continue;
		const missing = unknown.get(id);
		if (missing) {
			if (!missing.includes(node.id)) missing.push(node.id);
			continue;
		}
		const found =
			id === runDevice.id
				? runDevice
				: id === devices.walker.id
					? devices.walker
					: await devices.nodeDevice(id);
		if (found) named.set(id, found);
		else unknown.set(id, [node.id]);
	}
	if (unknown.size > 0) {
		const words: string[] = [];
		for (const [id, nodeIds] of unknown) {
			const name = (await devices.deviceName?.(id)) ?? null;
			const which = nodeIds.map((nodeId) => `"${nodeId}"`).join(", ");
			words.push(
				name === null
					? `The flow runs ${which} on a device that is not in this Space, or that you cannot use. Choose another device.`
					: `The flow runs ${which} on ${name}, which is not in this Space, or that you cannot use. Choose another device.`,
			);
		}
		throw new Refusal("invalid", words.join(" "));
	}

	// The Device of each profile, by its id: null when the Space has none.
	const owners = new Map<string, PlacedOn<D> | null>();
	for (const node of nodes) {
		const ref = profileOf(node);
		if (ref === undefined || owners.has(ref.device)) continue;
		owners.set(
			ref.device,
			ref.device === runDevice.id
				? runDevice
				: ref.device === devices.walker.id
					? devices.walker
					: await devices.nodeDevice(ref.device),
		);
	}
	const wanted = new Map<PlacedOn<D>, Set<string>>();
	for (const node of nodes) {
		const ref = profileOf(node);
		if (ref === undefined) continue;
		const at = owners.get(ref.device);
		// Another Person's Device resolves its offered profiles itself.
		if (!at || at.offered) continue;
		const set = wanted.get(at) ?? new Set();
		set.add(ref.profile);
		wanted.set(at, set);
	}
	const found = new Map<PlacedOn<D>, Record<string, ProfileSettings>>();
	const lastKnownOf = new Map<
		string,
		Promise<ReadonlyMap<
			string,
			{ name: string; settings: ProfileSettings }
		> | null>
	>();
	const lastKnown = (deviceId: string) => {
		let known = lastKnownOf.get(deviceId);
		if (!known) {
			known = devices.lastKnown?.(deviceId) ?? Promise.resolve(null);
			lastKnownOf.set(deviceId, known);
		}
		return known;
	};
	for (const [at, ids] of wanted) {
		if (at.offline) {
			// Its profiles as its document last said: its steps wait for it.
			const known = await lastKnown(at.id);
			found.set(
				at,
				Object.fromEntries(
					[...ids].flatMap((id) => {
						const profile = known?.get(id);
						return profile ? [[id, profile.settings]] : [];
					}),
				),
			);
			continue;
		}
		found.set(
			at,
			at.thisDevice
				? Object.fromEntries(
						[...ids].flatMap((id) => {
							const profile = devices.profileFor(id);
							return profile ? [[id, profile]] : [];
						}),
					)
				: await rules.profilesOn(at.device, [...ids]),
		);
	}

	// What a refusal calls a profile: its name as its Device last said.
	const labels = new Map<string, string | null>();
	for (const node of nodes) {
		const ref = profileOf(node);
		if (ref === undefined) continue;
		const key = `${ref.device}\u0000${ref.profile}`;
		if (labels.has(key)) continue;
		const known = (await lastKnown(ref.device))?.get(ref.profile)?.name;
		labels.set(key, known ?? null);
	}
	const labelOf = (ref: ProfileRef) =>
		labels.get(`${ref.device}\u0000${ref.profile}`) ?? null;

	const problems = new Map<string, string[]>();
	const wordsOf = new Map<string, (nodeIds: string) => string>();
	const problem = (
		words: (nodeIds: string) => string,
		key: string,
		nodeId: string,
	) => {
		const entry = problems.get(key) ?? [];
		if (!entry.includes(nodeId)) problems.set(key, [...entry, nodeId]);
		wordsOf.set(key, words);
	};
	const gone = new Map<string, string | null>();
	for (const [deviceId, at] of owners) {
		if (at === null)
			gone.set(deviceId, (await devices.deviceName?.(deviceId)) ?? null);
	}
	// A profile that does not fit its node: an Agent on a Model Profile, a
	// Decision on an Agent Profile, a Value on a decider that cannot make one.
	const misfits: string[] = [];
	const placeOne = (node: FlowNode): FlowNode => {
		const ref = profileOf(node);
		if (ref === undefined) return node;
		const at = owners.get(ref.device);
		if (!at) {
			const name = gone.get(ref.device) ?? null;
			problem(
				(ids) =>
					name === null
						? `The flow uses a profile of a device that is no longer in this Space (${ids}). Pick another profile.`
						: `${name} is no longer in this Space. Pick another profile for ${ids}.`,
				`gone\u0000${ref.device}`,
				node.id,
			);
			return node;
		}
		// Offered: the run's copy never holds the profile's settings.
		if (at.offered) {
			byId.set(at.id, at);
			return node;
		}
		const label = labelOf(ref);
		const settings = found.get(at)?.[ref.profile];
		if (!settings) {
			problem(
				(ids) =>
					at.offline
						? `${at.name} is offline, and Night Shift does not know ${label === null ? "its profile" : `its profile ${label}`} (${ids}). Start the run when ${at.name} is online, or pick another profile.`
						: label === null
							? `The flow uses a profile on ${at.name} (${ids}) that ${at.name} no longer has. Pick another profile.`
							: `The flow uses ${label} on ${at.name} (${ids}), but ${at.name} has no such profile. Pick another profile.`,
				`missing\u0000${ref.device}\u0000${ref.profile}`,
				node.id,
			);
			return node;
		}
		const resolved = resolveNodeProfile(node, settings, label ?? undefined);
		if ("problem" in resolved) {
			if (!misfits.includes(resolved.problem)) {
				misfits.push(resolved.problem);
			}
			return node;
		}
		byId.set(at.id, at);
		return resolved.node;
	};
	const placed = flows.map((flow) => ({
		...flow,
		nodes: flow.nodes.map((node): FlowNode => {
			if (!hasCascade(node)) return placeOne(node);
			let climbing: FlowNode = node;
			for (const tier of tierUsers(node)) {
				const resolved = placeOne(tier.node);
				if (resolved !== tier.node) {
					climbing = withTierNode(climbing, tier.index, resolved);
				}
			}
			const problem = cascadeProblem(climbing);
			if (problem !== null && !misfits.includes(problem)) {
				misfits.push(problem);
			}
			return climbing;
		}),
	}));
	if (problems.size > 0) {
		throw new Refusal(
			"invalid",
			[...problems]
				.map(([key, nodeIds]) =>
					(wordsOf.get(key) as (ids: string) => string)(nodeIds.join(", ")),
				)
				.join(" "),
		);
	}
	if (misfits.length > 0) throw new Refusal("invalid", misfits.join(" "));
	await checkAddresses(placed, owners, labelOf, rules);
	return { flows: placed, named, byId };
}
