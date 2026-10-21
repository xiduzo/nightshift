import { type Flow, runsEach } from "../document";
import type { CallNode } from "../nodes";
import type { Flows, Report, ValidateOptions } from "./issues";

/** The checks of a Call node that need the flow it calls. */

/**
 * The number of errors of a called flow, checked with the calls that led
 * to it (`chain`). The flow check passes itself, so this file does not
 * import it.
 */
export type ErrorsOf = (
	flow: Flow,
	options: ValidateOptions,
	chain: readonly string[],
) => number;

/**
 * The called flow must exist and parse, take every binding, and get every
 * required input without a default. It may not lead back to the flow being
 * checked (the last of `chain`). Cycles through an outer flow are left to
 * that flow, so each is reported once.
 */
export function checkCall(
	node: CallNode,
	flows: Flows,
	chain: readonly string[],
	error: Report,
	warning: Report,
	errorsOf: ErrorsOf,
): void {
	const at = { nodeId: node.id };
	const kind = "Subflow";
	const runs = `${kind} node "${node.id}" runs flow "${node.flow}"`;
	if (!Object.hasOwn(flows, node.flow)) {
		error(`${runs}, which does not exist.`, at);
		return;
	}
	const called = flows[node.flow];
	if (!called) {
		error(`${runs}, which is not valid. Open that flow and fix it first.`, at);
		return;
	}

	const inputs = new Map(called.inputs.map((input) => [input.name, input]));
	const bound = new Set(Object.keys(node.inputs));
	if (runsEach(node)) {
		const { as: name } = node.each;
		const as = inputs.get(name);
		if (as === undefined) {
			error(
				`${runs}, which has no input "${name}" to take each item. Add a json input "${name}" to it, or change "as".`,
				at,
			);
		} else if (as.type === "text") {
			warning(
				`${runs}, whose input "${name}" is text: an item that is an object or an array arrives as JSON text. Make it a json input.`,
				at,
			);
		}
		if (bound.has(name)) {
			error(
				`${kind} node "${node.id}" binds the input "${name}", which already takes each item.`,
				at,
			);
		}
		bound.add(name);
	}
	for (const name of Object.keys(node.inputs)) {
		if (!inputs.has(name)) {
			error(
				`${kind} node "${node.id}" binds the input "${name}", but flow "${node.flow}" has no such input.`,
				at,
			);
		}
	}
	for (const input of called.inputs) {
		if (
			input.required &&
			input.default === undefined &&
			!bound.has(input.name)
		) {
			error(
				`${kind} node "${node.id}" does not bind the required input "${input.name}" of flow "${node.flow}".`,
				at,
			);
		}
	}

	const self = chain.at(-1);
	if (self !== undefined) {
		const path = pathBack(node.flow, self, flows, new Set(chain.slice(0, -1)));
		if (path !== null) {
			error(
				`${runs}, which runs this flow again: ${[self, ...path].join(" → ")}. A flow cannot contain itself.`,
				at,
			);
		}
	}
	if (chain.includes(node.flow)) return;

	const count = errorsOf(called, { flows, name: node.flow }, chain);
	if (count > 0) {
		error(
			`Flow "${node.flow}" of ${kind} node "${node.id}" has ${count} ${count === 1 ? "error" : "errors"}.`,
			at,
		);
	}
}

/**
 * The shortest chain of calls (Call nodes) from `start` to `target`, both
 * included, or null. Does not pass through `skip`.
 */
function pathBack(
	start: string,
	target: string,
	flows: Flows,
	skip: ReadonlySet<string>,
): string[] | null {
	if (start === target) return [start];
	if (skip.has(start)) return null;
	const parent = new Map<string, string>([[start, start]]);
	const queue = [start];
	for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
		const flow = Object.hasOwn(flows, name) ? flows[name] : null;
		for (const node of flow?.nodes ?? []) {
			if (node.type !== "call") continue;
			if (parent.has(node.flow)) continue;
			parent.set(node.flow, name);
			if (node.flow === target) {
				const path = [target];
				for (let at = name; at !== start; ) {
					path.push(at);
					at = parent.get(at) ?? start;
				}
				path.push(start);
				return path.reverse();
			}
			if (!skip.has(node.flow)) queue.push(node.flow);
		}
	}
	return null;
}
