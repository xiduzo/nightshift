import { type FlowSource, isRecord, suffixedName } from "@nightshift/flows";
import { same } from "./flow-json";

/**
 * The merge of one Project's flow document into another's: what a Project
 * that maps onto a Project of another Space does with its flows and
 * schedules. Both keep every flow and every revision.
 *
 * - The flows of the destination keep their names. A flow of the source
 *   with the name and the content of a flow there keeps its name: a read
 *   takes the older of the two. Another flow of the source whose name the
 *   destination has takes the next free name
 *   (`suffixedName`: `triage-2`), and keeps it: the name is stored, so it
 *   does not change when the other flow goes. Its schedules follow it.
 * - Each flow keeps its id, and with it its revisions: the history of
 *   each flow of the source joins the destination's history.
 * - A schedule of the source that the destination has as it is, is one
 *   schedule. One with the id of another schedule there takes the next
 *   free id.
 * - `persons` gives a Person of the source their id in the destination:
 *   a schedule's Person and a revision's Person take it.
 *
 * A merge into a Project whose document is not all here (`apart`: a split
 * of a Project whose flows still wait for the Host) keeps what it adds
 * apart from what comes later. Each schedule takes an id of its own and is
 * off. Each flow takes a name of its own too: its schedules and the Calls
 * of the flows that came with it follow.
 *
 * A merge that runs again changes nothing: a revision that the
 * destination has stays one, and the flows and schedules of a source
 * that merged into the destination before are not added again.
 */

/** What a merge renames, by the name a read of the source gives. */
export type FlowMergePlan = {
	/** A flow of the source: the name it takes in the destination. */
	flows: Record<string, string>;
	/** A schedule of the source: the id it takes in the destination. */
	schedules: Record<string, string>;
};

/** The longest flow name and schedule id. */
const MAX_NAME = 60;

/**
 * The name that each name takes to keep apart (`apart`): no document that
 * comes later has it, and no two take one. `taken`: names of the
 * destination already.
 */
export function apartNames(
	names: readonly string[],
	apart: string,
	taken: ReadonlySet<string>,
): Record<string, string> {
	const used = new Set(taken);
	const apartName = (name: string) => {
		const base = name.slice(0, MAX_NAME - apart.length - 1).replace(/-+$/, "");
		const free = suffixedName(`${base}-${apart}`, used);
		used.add(free);
		return free;
	};
	return Object.fromEntries(names.map((name) => [name, apartName(name)]));
}

/** A node with the flows it calls by their new names. A kit, and a flow that did not change, stay. */
export function withCalls(
	node: unknown,
	flows: Readonly<Record<string, string>>,
): unknown {
	if (!isRecord(node) || node.type !== "call") return node;
	const renamed = <T>(value: T): T | string =>
		typeof value === "string" && Object.hasOwn(flows, value)
			? (flows[value] as string)
			: value;
	const call = { ...node, flow: renamed(node.flow) };
	if (!Array.isArray(node.cascade)) return call;
	return {
		...call,
		cascade: node.cascade.map((tier: unknown) =>
			isRecord(tier) && "flow" in tier
				? { ...tier, flow: renamed(tier.flow) }
				: tier,
		),
	};
}

/** The same flow on both sides: both read, with the same content. */
export function sameFlow(a: FlowSource | undefined, b: FlowSource | undefined) {
	return (
		a !== undefined &&
		b !== undefined &&
		"json" in a &&
		"json" in b &&
		same(a.json, b.json)
	);
}

/**
 * A schedule of the source as the destination takes it: its flow by its
 * new name, its Person by their id there.
 */
export function mergedSchedule(
	raw: unknown,
	flows: Readonly<Record<string, string>>,
	persons: Readonly<Record<string, string>>,
): unknown {
	if (!isRecord(raw)) return raw;
	const flow = raw.flow;
	const renamed =
		typeof flow === "string" && Object.hasOwn(flows, flow)
			? { ...raw, flow: flows[flow] }
			: raw;
	return withPerson(renamed, "person", persons);
}

/** The value with the Person in `field` replaced by their id in `persons`, when it names one. */
export function withPerson(
	value: unknown,
	field: string,
	persons: Readonly<Record<string, string>>,
): unknown {
	if (!isRecord(value)) return value;
	const person = value[field];
	if (typeof person !== "string" || !Object.hasOwn(persons, person)) {
		return value;
	}
	return { ...value, [field]: persons[person] };
}

/** A plain object: not null, not an array. */
