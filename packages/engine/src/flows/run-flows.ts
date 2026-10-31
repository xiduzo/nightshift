import {
	calledFlowNames,
	type Flow,
	type FlowIssue,
	type FlowSources,
	isKitName,
	kitFlow,
	migrateFlow,
	parsedFlows,
	parseFlow,
	validateFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../contract";

/** The names of the flows a flow's Call nodes call, a cascade's tiers too. */
function callsOf(flow: Flow): string[] {
	return flow.nodes.flatMap((n) =>
		n.type === "call" ? calledFlowNames(n) : [],
	);
}

function refuseErrors(issues: readonly FlowIssue[], what = "The flow"): void {
	const errors = issues.filter((i) => i.severity === "error");
	if (errors.length === 0) return;
	const list = errors.map((e) => `- ${e.message}`).join("\n");
	throw new Refusal(
		"invalid",
		`${what} cannot run. Fix ${errors.length === 1 ? "this error" : `these ${errors.length} errors`} first:\n${list}`,
	);
}

/**
 * Loads, parses and validates the flow a run starts from, and every flow
 * it can call through Call nodes (by name, from the project's flow files,
 * or a kit of this Night Shift). Version 1 files migrate first. The run
 * keeps a copy of each, kits too, so a run on another Device walks the
 * same flows, and the Flow revision of each that has one.
 */
export function flowsForRun(
	sources: FlowSources,
	input: StartRunInput,
): {
	flow: Flow;
	flowName: string | null;
	/** The Flow revision of the flow by name. Null for a flow without one, and for a flow of the input. */
	flowRevision: string | null;
	calledFlows: Record<string, Flow>;
	/** The Flow revision of each called flow that has one, by name. */
	calledFlowRevisions: Record<string, string>;
} {
	const files = parsedFlows(sources);
	let flow: Flow;
	let flowName: string | null;
	if (input.flowName !== undefined) {
		const source = Object.hasOwn(sources, input.flowName)
			? sources[input.flowName]
			: undefined;
		if (!source) {
			throw new Refusal(
				"not-found",
				`The flow "${input.flowName}" does not exist.`,
			);
		}
		const parsed = parseFlow(
			migrateFlow("json" in source ? source.json : null),
			{
				flows: files,
				name: input.flowName,
			},
		);
		refuseErrors(parsed.issues);
		if (!parsed.flow) {
			throw new Refusal(
				"invalid",
				`The flow "${input.flowName}" is not valid.`,
			);
		}
		flow = parsed.flow;
		flowName = input.flowName;
	} else {
		const parsed = parseFlow(migrateFlow(input.flow), { flows: files });
		refuseErrors(parsed.issues);
		if (!parsed.flow) throw new Refusal("invalid", "The flow is not valid.");
		flow = parsed.flow;
		flowName = null;
	}
	const revisionOf = (name: string): string | null => {
		const source = Object.hasOwn(sources, name) ? sources[name] : undefined;
		return source && "json" in source ? (source.revision ?? null) : null;
	};
	const calledFlows: Record<string, Flow> = {};
	const calledFlowRevisions: Record<string, string> = {};
	const queue = callsOf(flow);
	while (queue.length > 0) {
		const name = queue.shift() as string;
		if (Object.hasOwn(calledFlows, name)) continue;
		const called =
			name === flowName ? flow : isKitName(name) ? kitFlow(name) : files[name];
		if (!called) {
			throw new Refusal(
				"invalid",
				`The called flow "${name}" ${called === null ? "is not valid" : "does not exist"}.`,
			);
		}
		refuseErrors(
			validateFlow(called, { flows: files, name }),
			`The called flow "${name}"`,
		);
		calledFlows[name] = called;
		const revision = isKitName(name) ? null : revisionOf(name);
		if (revision !== null) calledFlowRevisions[name] = revision;
		queue.push(...callsOf(called));
	}
	return {
		flow,
		flowName,
		flowRevision: flowName === null ? null : revisionOf(flowName),
		calledFlows,
		calledFlowRevisions,
	};
}
