import {
	type Flow,
	type FlowNode,
	isProfileRef,
	type ProfileRef,
	profileOf,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { type AddressCheck, addressKey } from "../device";
import type { PlacedDevice } from "./peers";

/**
 * A run asks each address its nodes name when it starts (ADR 5, decision
 * 6), after the plan resolved their Model Profiles. The profile's Device
 * asks: a profile on a Mac names `127.0.0.1`, which only the Mac reaches.
 * An offline Device and another Person's Device are not asked: an offline
 * one checks each call when it is back, an offered one resolves its
 * profiles itself. An address that does not answer refuses the run before
 * its first step, with the profile and the address in the message.
 */

/** The address a resolved node asks, and the profile it came from. */
function addressOf(
	node: FlowNode,
): { check: AddressCheck; ref: ProfileRef } | null {
	if (node.type !== "decision" && node.type !== "value") return null;
	if (node.by !== "model" || node.address === undefined) return null;
	const ref = profileOf(node);
	if (!isProfileRef(ref) || node.decider === undefined) return null;
	return { check: { decider: node.decider, address: node.address }, ref };
}

export async function checkAddresses(
	flows: readonly Flow[],
	/** The Device of each profile, by its id. */
	owners: ReadonlyMap<string, PlacedDevice | null>,
	/** What a refusal calls a profile: its name, or null when unknown. */
	labelOf: (ref: ProfileRef) => string | null,
): Promise<void> {
	type Use = { check: AddressCheck; label: string | null; nodeIds: string[] };
	const asked = new Map<PlacedDevice, Map<string, Use>>();
	for (const node of flows.flatMap((flow) => flow.nodes)) {
		const found = addressOf(node);
		if (!found) continue;
		const at = owners.get(found.ref.device);
		if (!at || at.offline || at.offered) continue;
		const uses = asked.get(at) ?? new Map<string, Use>();
		const label = labelOf(found.ref);
		const key = `${addressKey(found.check)}\u0000${label}`;
		const use = uses.get(key) ?? { check: found.check, label, nodeIds: [] };
		if (!use.nodeIds.includes(node.id)) use.nodeIds.push(node.id);
		uses.set(key, use);
		asked.set(at, uses);
	}
	const problems: string[] = [];
	for (const [at, uses] of asked) {
		const checks = [...uses.values()].map((use) => use.check);
		// A Device that cannot answer now fails the step itself, later.
		const answers = await at.device
			.capabilities({ addresses: checks })
			.then((has) => has.addresses ?? {})
			.catch(() => ({}) as Record<string, string | null>);
		for (const use of uses.values()) {
			const why = answers[addressKey(use.check)];
			if (why === undefined || why === null) continue;
			const where = at.thisDevice ? "" : ` on ${at.name}`;
			const profile =
				use.label === null
					? `A profile${where}`
					: `The profile ${use.label}${where}`;
			problems.push(
				`${profile} uses the address ${use.check.address.baseUrl} (${use.nodeIds.join(", ")}). ${why}`,
			);
		}
	}
	if (problems.length > 0) throw new Refusal("conflict", problems.join(" "));
}
