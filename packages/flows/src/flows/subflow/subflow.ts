/**
 * "Make subflow from section": the plan that moves a Section's nodes into a
 * flow file of their own and puts a Call node (Subflow) in their place
 * (canvas research §3.5 option b). Pure: the editor shows the changes, and
 * writes both files when the person agrees.
 *
 * The plan keeps what the flow does, with existing node kinds only:
 *
 * - The new flow starts at the Section's entry. A template inside that reads
 *   a node outside, an input of the flow or a run field that differs inside
 *   a Call (`flow`, `base_branch`, `index`) reads an input of the new flow
 *   instead, and the Call node binds it.
 * - A variable used inside becomes a variable of the new flow, which starts
 *   from an input the Call binds to the caller's value. A variable written
 *   inside is also an output, and the Call node writes it back (`set`).
 * - A template outside that reads a node inside reads an output of the
 *   Call instead (`{{build.summary}}` → `{{<call>.build_summary}}`).
 * - Each exit (a node and outcome that leaves the Section) ends the new flow
 *   on a label of its own, at an end node (a Decision by rule with one
 *   option), when the Call must tell it apart. The Call ends `pass` with
 *   that label in `ended`, and a Decision by rule after the Call routes on
 *   it to the exit's old edges, `max` and ids included. With one exit and
 *   no end inside, the Call's `pass` edge goes there straight.
 * - Where the flow could end inside the Section, the Decision has an option
 *   without an edge, so the caller ends there too.
 *
 * What it cannot keep comes back as blockers. Codes, not words: the editor
 * writes the words, as for `canMakeSection`.
 */
import { type Flow, flowSchema } from "../../flow";
import { flowNameSchema } from "../../nodes";
import { canMakeSection, nodesWithin } from "../../sections";
import { type ValidateOptions, validateFlow } from "../../validate";
import { callerDraftOf, loopsBack } from "./caller";
import { differences } from "./differences";
import { subflowEndNodes, subflowExits } from "./exits";
import { subflowInputs, subflowNames } from "./inputs";
import { subflowDraftOf } from "./new-flow";
import { subflowOutputs } from "./outputs";
import type {
	SubflowBlocker,
	SubflowChange,
	SubflowOptions,
	SubflowPlan,
} from "./plan";
import { groupKey, Planner, uniqueList } from "./planner";

/**
 * Plans "Make subflow from section" for the Section `sectionId` of `flow`:
 * the new flow, the rewritten caller and the changes to show, or every
 * blocker found. See the top of this file for what it keeps and how.
 */
export function planSubflowFromSection(
	flow: Flow,
	sectionId: string,
	options: SubflowOptions,
): SubflowPlan {
	const section = flow.sections?.find((s) => s.id === sectionId);
	if (!section) {
		return {
			ok: false,
			blockers: [{ code: "section-not-found", section: sectionId }],
		};
	}
	const blockers: SubflowBlocker[] = [];
	const { name } = options;
	if (!flowNameSchema.safeParse(name).success) {
		blockers.push({ code: "name-not-valid", name });
	} else if (
		options.existingFlowNames.includes(name) ||
		name === options.flowName ||
		(options.flows !== undefined && Object.hasOwn(options.flows, name))
	) {
		blockers.push({ code: "name-taken", name });
	}
	const check = canMakeSection(flow, section.nodes, {
		section: sectionId,
		sections: section.sections ?? [],
	});
	if (!check.ok) {
		blockers.push({ code: "section-not-valid", problems: check.problems });
		return { ok: false, blockers };
	}
	const errors = validateFlow(flow, validateOptions(options)).filter(
		(issue) => issue.severity === "error",
	).length;
	if (errors > 0) {
		blockers.push({ code: "flow-not-valid", errors });
		return { ok: false, blockers };
	}

	const plan = new Planner(
		flow,
		nodesWithin(flow, section),
		check.entry,
		options,
	);
	blockers.push(...plan.blockers());
	if (blockers.length > 0) return { ok: false, blockers };
	return build(plan, sectionId, section.label, section.description, blockers);
}

function validateOptions(options: SubflowOptions): ValidateOptions {
	return options.flows === undefined
		? {}
		: {
				flows: options.flows,
				...(options.flowName !== undefined && { name: options.flowName }),
			};
}

/** The new flow, the caller and the changes. Call only when `blockers()` found none. */
function build(
	plan: Planner,
	sectionId: string,
	sectionLabel: string,
	sectionDescription: string | undefined,
	blockers: SubflowBlocker[],
): SubflowPlan {
	const { flow, options, entry, members } = plan;
	const changes: SubflowChange[] = [];
	const { subTaken, callerTaken, callId } = subflowNames(plan);
	const { inputs, bindings, inputOf, usedVars, writers, subVariables } =
		subflowInputs(plan, subTaken, changes);
	const { outputs, outputOf, writeBack } = subflowOutputs(
		plan,
		{ usedVars, writers },
		callId,
		changes,
	);
	const { ends, endOptions, decided, exitLabels } = subflowExits(plan);
	const { minX, minY, shift, endNodes } = subflowEndNodes(
		plan,
		{ decided, exitLabels },
		subTaken,
	);
	const subflowDraft = subflowDraftOf(plan, sectionId, sectionDescription, {
		inputs,
		outputs,
		subVariables,
		inputOf,
		endNodes,
		shift,
	});
	const { decisionId, decision, callerDraft } = callerDraftOf(
		plan,
		sectionId,
		sectionLabel,
		{
			callId,
			callerTaken,
			bindings,
			writeBack,
			outputOf,
			decided,
			exitLabels,
			endOptions,
			minX,
			minY,
		},
	);

	// A loop through the Call needs a limit outside the Section.
	const unbounded = loopsBack(callerDraft, callId);
	if (unbounded) {
		blockers.push({
			code: "loop-without-limit",
			edges: flow.edges
				.filter(
					(e) =>
						members.has(e.from) && members.has(e.to) && e.max !== undefined,
				)
				.map((e) => e.id),
		});
		return { ok: false, blockers };
	}

	const parsedSub = flowSchema.safeParse(subflowDraft);
	const parsedCaller = flowSchema.safeParse(callerDraft);
	if (!parsedSub.success || !parsedCaller.success) {
		for (const [which, parsed] of [
			["subflow", parsedSub],
			["caller", parsedCaller],
		] as const) {
			if (!parsed.success)
				blockers.push({
					code: "result-not-valid",
					flow: which,
					issues: parsed.error.issues.map((issue) => ({
						severity: "error",
						message: `${issue.path.join(".")}: ${issue.message}`,
					})),
				});
		}
		return { ok: false, blockers };
	}
	const subflow = parsedSub.data;
	const caller = parsedCaller.data;
	const flows =
		options.flows === undefined
			? undefined
			: { ...options.flows, [options.name]: subflow };
	const subIssues = validateFlow(
		subflow,
		flows ? { flows, name: options.name } : {},
	).filter((issue) => issue.severity === "error");
	const callerIssues = validateFlow(
		caller,
		flows
			? {
					flows,
					...(options.flowName !== undefined && { name: options.flowName }),
				}
			: {},
	).filter((issue) => issue.severity === "error");
	if (subIssues.length > 0)
		blockers.push({
			code: "result-not-valid",
			flow: "subflow",
			issues: subIssues,
		});
	if (callerIssues.length > 0)
		blockers.push({
			code: "result-not-valid",
			flow: "caller",
			issues: callerIssues,
		});
	if (blockers.length > 0) return { ok: false, blockers };

	// What the dialog lists: first what moves, then what works differently.
	const exitChanges: SubflowChange[] = plan.exits.map((exit, index) => ({
		kind: "info",
		code: "exit-added",
		label: exitLabels[index] ?? exit.outcome,
		from: exit.from,
		outcome: exit.outcome,
		to: uniqueList(exit.edges.map((e) => e.to)),
		endNode: endNodes.get(groupKey(exit))?.id ?? null,
	}));
	const head: SubflowChange[] = [
		{
			kind: "info",
			code: "nodes-moved",
			nodes: plan.inner.map((node) => node.id),
			entry,
		},
		{ kind: "info", code: "call-added", node: callId, flow: options.name },
	];
	if (members.has(flow.start))
		head.push({
			kind: "info",
			code: "start-moved",
			from: flow.start,
			to: callId,
		});
	const tail: SubflowChange[] = [...exitChanges];
	if (decision)
		tail.push({
			kind: "info",
			code: "decision-added",
			node: decision.id,
			options: decision.options.map((option) => option.name),
		});
	if (ends.length > 0)
		tail.push({
			kind: "info",
			code: "ends-inside",
			ends: ends.map((end) => ({
				node: end.node.id,
				outcome: end.outcome,
				option: decision ? end.label || "pass" : null,
			})),
		});
	tail.push({ kind: "info", code: "section-removed", section: sectionId });
	tail.push({ kind: "differs", code: "restarts-on-resume" });
	tail.push(...differences(plan));

	return {
		ok: true,
		subflow,
		caller,
		callNode: callId,
		decisionNode: decisionId,
		changes: [...head, ...changes, ...tail],
	};
}
