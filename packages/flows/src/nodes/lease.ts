import { z } from "zod";
import { holdScopeSchema, type NodeCheck, nodeBase } from "./base";

/**
 * The Lease node (ADR 7): it takes a named lease of the Space, so only one
 * run at a time does the steps after it. The engine keeps the lease until
 * the run ends, whatever ends it, and lets the next run have it then.
 */

/**
 * Takes the lease `name`, a template (`branch:{{pr.data.head}}`,
 * `zac-docker-stack`). Only one run of the Space holds a name at a time:
 * runs on different Devices of the Space take turns too. A run that holds
 * the name takes it again at once.
 *
 * Outcomes: `held` when the run holds the lease, `busy` when another run
 * holds it after `waitMinutes` (unset or 0: it does not wait). `busy`
 * names the run that holds it (`holder`, `holder_title`).
 *
 * The engine lets go of the lease when the run leaves its `scope`, and on
 * every end of the run. The run renews the lease while it lives. When the Device that walks it
 * is gone longer than `ttlMinutes` (default 30), the lease expires.
 */
export const leaseNodeSchema = z.object({
	...nodeBase,
	type: z.literal("lease"),
	/** The lease's name. A template. */
	name: z.string().min(1),
	/** How long the node waits for a busy lease. Unset or 0: it does not wait. */
	waitMinutes: z.number().int().nonnegative().optional(),
	/**
	 * How long the lease holds without a renewal. Unset: 30. At least 2:
	 * the run renews it every minute.
	 */
	ttlMinutes: z.number().int().min(2).optional(),
	/** Until when the run holds the lease. Unset: `run`. */
	scope: holdScopeSchema.optional(),
});
export type LeaseNode = z.infer<typeof leaseNodeSchema>;

/** How long a lease holds without a renewal when its node sets no `ttlMinutes`. */
export const DEFAULT_LEASE_TTL_MINUTES = 30;

/** The outcomes of a Lease node, in the order its handles show. */
export const leaseOutcomes = ["held", "busy"] as const;

/**
 * name: the lease's name as rendered. holder: the id of the run that holds
 * it, on `busy`. holder_title: that run's title. waited_minutes: how long
 * the node waited for it.
 */
export const leaseOutputFields = [
	"outcome",
	"name",
	"holder",
	"holder_title",
	"waited_minutes",
	"visit",
] as const;

/** The Section a Lease node holds its lease for, or null for the run. */
export function leaseSection(node: LeaseNode): string | null {
	return typeof node.scope === "object" ? node.scope.section : null;
}

/**
 * A Lease node's name reads known names. A Section scope names a Section
 * of the flow that holds the node. Its wait is `waitMinutes`: the node has
 * no timeout of its own.
 */
export function checkLeaseNode(node: LeaseNode, check: NodeCheck): void {
	check.template(node.name, "name");
	const section = leaseSection(node);
	if (section !== null) {
		const nodes = check.section(section);
		if (nodes === null) {
			check.error(
				`Lease node "${node.id}" holds its lease until the run leaves the Section "${section}", but the flow has no such Section. Pick a Section, or hold the lease for the whole run.`,
			);
		} else if (!nodes.includes(node.id)) {
			check.error(
				`Lease node "${node.id}" holds its lease for the Section "${section}", but it is not in that Section. Move the node into the Section, or pick the Section it is in.`,
			);
		}
	}
	if (node.timeoutMinutes !== undefined) {
		check.warning(
			`Lease node "${node.id}" does not use its timeout. Set how long it waits with waitMinutes.`,
		);
	}
}
