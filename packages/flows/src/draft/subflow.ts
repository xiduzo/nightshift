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
import {
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	type FlowInputDef,
	type FlowNode,
	type FlowOutputDef,
	type FlowVariableDef,
	flowSchema,
	jsonOutputFields,
	nodeOutcomes,
	outcomeColor,
} from "../document";
import {
	type CallNode,
	commandExits,
	type DecisionNode,
	flowNameSchema,
	type Option,
	reservedOutcomes,
	type VariableWrite,
} from "../nodes";
import {
	canMakeSection,
	type SectionExit,
	type SectionProblem,
	sectionBoundary,
} from "../sections";
import {
	ruleNames,
	ruleVariableNames,
	type TemplateRef,
	templateRefs,
} from "../template";
import {
	type FlowIssue,
	type ValidateOptions,
	validateFlow,
} from "../validate";
import { rewriteOwnTemplates, rewriteRefs, rewriteTemplates } from "./refs";
import { removeSection } from "./sections";

export type SubflowOptions = {
	/** The new flow's file name, without `.json`. */
	name: string;
	/** The names of the project's flow files, the caller's own included. */
	existingFlowNames: readonly string[];
	/**
	 * The project's flows by name (null: a file that does not parse), for
	 * the checks of Call nodes. Without it, the plan checks both flows
	 * without the Call checks.
	 */
	flows?: Readonly<Record<string, Flow | null>>;
	/** The caller's own file name, when it has one. */
	flowName?: string;
};

/** A node or a flow output of the caller that reads a value. */
export type SubflowReader = { node: string } | { output: string };

/** Where the value of an input of the new flow comes from, in the caller. */
export type SubflowInputSource =
	| { kind: "node"; node: string; field: string }
	| { kind: "input"; input: string }
	| { kind: "run"; field: "flow" | "base_branch" | "index" }
	| { kind: "variable"; variable: string };

/**
 * One thing the plan does or changes, for the dialog to list. `kind`:
 * `info` is what the action does; `differs` is a way the flow works
 * differently afterwards, which the person should see before agreeing.
 *
 * - `nodes-moved`: these nodes move to the new flow, which starts at `entry`.
 * - `call-added`: the Call node that takes their place.
 * - `start-moved`: the flow started inside the Section; it starts at the Call now.
 * - `input-added`: an input of the new flow, bound by the Call to `source`.
 *   `readBy`: the nodes inside that read it (or write it, for a variable).
 * - `output-added`: an output of the new flow, a node's field that `readBy`
 *   (outside) now read from the Call.
 * - `variable-written-back`: a variable that nodes inside write. The new
 *   flow returns it as `output`, and the Call writes it back.
 * - `exit-added`: an exit of the Section. The new flow ends there on
 *   `label` (at `endNode`, null when the node itself ends it), and the
 *   caller goes on to `to`.
 * - `decision-added`: a Decision by rule after the Call that routes on the
 *   label the new flow ended on.
 * - `ends-inside`: outcomes inside that end the run (no edge). The new flow
 *   ends there, and the caller ends at the Decision's `option` (null: at
 *   the Call). The run's end reason names the caller's node.
 * - `section-removed`: the Section goes from the caller.
 * - `restarts-on-resume` (differs): when a step inside fails, the run
 *   stops at the Call, and a resume runs the new flow again from its start.
 * - `reads-earlier-pass` (differs): the flow can come back into the
 *   Section, and `node` reads `reads` (inside), which may not have run yet
 *   in this pass. Before, it read the value of an earlier pass. Now it reads
 *   nothing, as each run of the Subflow starts without node values.
 * - `visit-per-call` (differs): `node` reads the visit count of `reads`
 *   (inside), which now counts from 1 in each run of the Subflow.
 * - `loop-limit-per-call` (differs): these edges inside have a `max`, which
 *   now counts in each run of the Subflow, not in the whole run.
 * - `session-per-call` (differs): these Agent nodes continue their last
 *   session (`session: "resume"`). A new run of the Subflow starts a new one.
 */
export type SubflowChange =
	| { kind: "info"; code: "nodes-moved"; nodes: string[]; entry: string }
	| { kind: "info"; code: "call-added"; node: string; flow: string }
	| { kind: "info"; code: "start-moved"; from: string; to: string }
	| {
			kind: "info";
			code: "input-added";
			input: string;
			type: "text" | "json";
			source: SubflowInputSource;
			readBy: string[];
	  }
	| {
			kind: "info";
			code: "output-added";
			output: string;
			node: string;
			field: string;
			readBy: SubflowReader[];
	  }
	| {
			kind: "info";
			code: "variable-written-back";
			variable: string;
			output: string;
			writtenBy: string[];
	  }
	| {
			kind: "info";
			code: "exit-added";
			label: string;
			from: string;
			outcome: string;
			to: string[];
			endNode: string | null;
	  }
	| { kind: "info"; code: "decision-added"; node: string; options: string[] }
	| {
			kind: "info";
			code: "ends-inside";
			ends: { node: string; outcome: string; option: string | null }[];
	  }
	| { kind: "info"; code: "section-removed"; section: string }
	| { kind: "differs"; code: "restarts-on-resume" }
	| {
			kind: "differs";
			code: "reads-earlier-pass";
			reads: { node: string; reads: string }[];
	  }
	| {
			kind: "differs";
			code: "visit-per-call";
			reads: { node: string; reads: string }[];
	  }
	| { kind: "differs"; code: "loop-limit-per-call"; edges: string[] }
	| { kind: "differs"; code: "session-per-call"; nodes: string[] };

/**
 * Why the Section cannot become a Subflow and keep its meaning.
 *
 * - `section-not-found`: the flow has no Section with that id.
 * - `name-not-valid`: the name is not a valid flow file name.
 * - `name-taken`: a flow of the project has that name.
 * - `section-not-valid`: the Section is not one connected part with one
 *   entry (`canMakeSection`). A start inside the Section that is not its
 *   entry is a second entry (`several-entries`).
 * - `flow-not-valid`: the flow has errors now. Fix them first.
 * - `stopped-edge`: these Call nodes inside go on along a `stopped` edge
 *   after the stop time. Inside a Subflow, the caller stops instead.
 * - `calls-new-flow`: these Call nodes inside call a flow of the new name.
 * - `mixed-exit`: edges on one outcome lead inside and outside, and an edge
 *   inside comes after an edge outside that has a `max`. Its count stays
 *   with the caller, so the new flow cannot pick between them.
 * - `rule-reads-outside`: a rule or an expression of `node` (inside) reads
 *   these nodes outside, or a run field that differs inside a Call
 *   (`run.flow`). Rules are not rewritten: read the value in a template, or
 *   move the node.
 * - `rule-reads-inside`: a rule or an expression of `node` (outside) reads
 *   these nodes inside.
 * - `loop-without-limit`: a loop through the Section has its only `max` on
 *   `edges` inside. Inside a Subflow it counts per run of the Subflow, so
 *   the loop through the Call has no limit. Give an edge outside a max.
 * - `result-not-valid`: the planned flow has errors (a safety net: the
 *   checks above should catch every case).
 */
export type SubflowBlocker =
	| { code: "section-not-found"; section: string }
	| { code: "name-not-valid"; name: string }
	| { code: "name-taken"; name: string }
	| { code: "section-not-valid"; problems: SectionProblem[] }
	| { code: "flow-not-valid"; errors: number }
	| { code: "stopped-edge"; nodes: string[] }
	| { code: "calls-new-flow"; nodes: string[] }
	| { code: "mixed-exit"; from: string; outcome: string; edges: string[] }
	| { code: "rule-reads-outside"; node: string; names: string[] }
	| { code: "rule-reads-inside"; node: string; names: string[] }
	| { code: "loop-without-limit"; edges: string[] }
	| {
			code: "result-not-valid";
			flow: "caller" | "subflow";
			issues: FlowIssue[];
	  };

export type SubflowPlan =
	| {
			ok: true;
			/** The new flow file, to save as `<name>.json`. */
			subflow: Flow;
			/** The flow with the Call node in place of the Section. */
			caller: Flow;
			/** The id of the Call node in `caller`. */
			callNode: string;
			/** The id of the Decision after the Call, or null when none is needed. */
			decisionNode: string | null;
			changes: SubflowChange[];
	  }
	| { ok: false; blockers: SubflowBlocker[] };

/** Run fields that read differently inside a Call: they become inputs. */
const CALL_RUN_FIELDS = ["flow", "base_branch", "index"] as const;
type CallRunField = (typeof CALL_RUN_FIELDS)[number];
/** The fields a Call node has besides its flow's outputs. */
const CALL_FIELDS = ["outcome", "ended", "visit"];
/** The space between nodes the plan places. */
const STEP_X = 384;
const STEP_Y = 144;

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
	const check = canMakeSection(flow, section.nodes, { section: sectionId });
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

	const plan = new Planner(flow, section.nodes, check.entry, options);
	blockers.push(...plan.blockers());
	if (blockers.length > 0) return { ok: false, blockers };
	return plan.build(sectionId, section.label, section.description, blockers);
}

function validateOptions(options: SubflowOptions): ValidateOptions {
	return options.flows === undefined
		? {}
		: {
				flows: options.flows,
				...(options.flowName !== undefined && { name: options.flowName }),
			};
}

/** A template a node holds. `self`: a variable write's value, where the node's id reads the step that just ended. */
type Text = { text: string; self: boolean };

/** One reference of a template or a rule to a node, an input, a variable or `run`. */
type Read = {
	reader: SubflowReader;
	name: string;
	/** The path below the name; rules give none. */
	path: string[];
	self: boolean;
	rule: boolean;
};

/** The templates of a node: its own, then the values of its variable writes. */
function templatesOf(node: FlowNode): Text[] {
	const texts: Text[] = [];
	rewriteOwnTemplates(node, (text) => {
		texts.push({ text, self: false });
		return text;
	});
	for (const write of node.set ?? []) {
		if (write.value !== undefined)
			texts.push({ text: write.value, self: true });
	}
	return texts;
}

/** The rules (JSONata) of a node: a Decision's `when`, a Value's expression, the expressions of its writes. */
function rulesOf(node: FlowNode): Text[] {
	const rules: Text[] = [];
	if (node.type === "decision") {
		for (const option of node.options) {
			if (option.when !== undefined && option.when.trim() !== "")
				rules.push({ text: option.when, self: false });
		}
	}
	if (node.type === "value" && node.expression !== undefined) {
		rules.push({ text: node.expression, self: false });
	}
	for (const write of node.set ?? []) {
		if (write.expression !== undefined && write.expression.trim() !== "")
			rules.push({ text: write.expression, self: true });
	}
	return rules;
}

/** Every reference the node's templates and rules make. */
function readsOf(node: FlowNode): Read[] {
	const reader = { node: node.id };
	const reads: Read[] = [];
	for (const { text, self } of templatesOf(node)) {
		for (const ref of templateRefs(text)) {
			reads.push({
				reader,
				name: ref.name,
				path: ref.path,
				self,
				rule: false,
			});
		}
	}
	for (const { text, self } of rulesOf(node)) {
		for (const name of ruleNames(text))
			reads.push({ reader, name, path: [], self, rule: true });
		for (const variable of ruleVariableNames(text))
			reads.push({ reader, name: "vars", path: [variable], self, rule: true });
	}
	return reads;
}

/** `run.flow`, `run.base_branch` and `run.index` in a rule, best effort. */
function ruleRunFields(text: string): CallRunField[] {
	const found = new Set<CallRunField>();
	for (const match of text.matchAll(
		/(^|[^A-Za-z0-9_$.])run\s*\.\s*(flow|base_branch|index)(?![A-Za-z0-9_])/g,
	)) {
		found.add(match[2] as CallRunField);
	}
	return [...found];
}

/**
 * Whether the node ending with `outcome` and no edge ends its flow as
 * chosen (`finished`), not as a failure. The same facts as the engine's
 * node kinds (`isChosenEnd`); a stop never ends a flow.
 */
function endsFlow(node: FlowNode, outcome: string): boolean {
	if (outcome === "stopped") return false;
	switch (node.type) {
		case "agent":
			return outcome === "pass" || ownAgentLabel(node, outcome);
		case "command":
			return commandExits(node).some(
				(exit) => exit.name === outcome && exit.code === 0,
			);
		case "decision":
			return true;
		case "call":
			return node.each !== undefined || outcome === "pass";
		case "wait":
			return outcome === "pass" || outcome === "done";
		case "value":
		case "tool":
			return outcome === "pass";
	}
}

/** The label a Call reports in `ended` when its flow ends at this node: the engine's `endedLabel`. */
function endedLabel(node: FlowNode, outcome: string): string {
	if (node.type === "decision") return outcome;
	if (node.type === "agent" && ownAgentLabel(node, outcome)) return outcome;
	return "";
}

function ownAgentLabel(
	node: FlowNode & { type: "agent" },
	outcome: string,
): boolean {
	return (
		node.outcomes !== undefined &&
		outcome !== "fail" &&
		outcome !== "needs-input"
	);
}

/** `base`, else `base<sep>2`, … not in `taken`, at most `max` long. Adds the result to `taken`. */
function claim(
	taken: Set<string>,
	base: string,
	max: number,
	sep: string,
): string {
	const trim = (text: string) => text.slice(0, max).replace(/[-_]+$/, "");
	let name = trim(base);
	for (let n = 2; taken.has(name); n++) {
		const suffix = `${sep}${n}`;
		name = `${trim(base).slice(0, max - suffix.length)}${suffix}`;
	}
	taken.add(name);
	return name;
}

/** A name a template reads (`[a-z][a-z0-9_]*`, at most 40) from any text. */
function nameFrom(text: string): string {
	const name = text.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
	return /^[a-z]/.test(name) ? name : `flow_${name}`;
}

function uniqueList<T>(items: readonly T[]): T[] {
	return [...new Set(items)];
}

/** The plan's analysis of one Section: what crosses its frame, and what that needs. */
class Planner {
	private readonly byId: Map<string, FlowNode>;
	private readonly members: Set<string>;
	private readonly inner: FlowNode[];
	private readonly exits: SectionExit[];
	private readonly reads: Read[];

	constructor(
		private readonly flow: Flow,
		nodeIds: readonly string[],
		private readonly entry: string,
		private readonly options: SubflowOptions,
	) {
		this.byId = new Map(flow.nodes.map((node) => [node.id, node]));
		this.members = new Set(nodeIds.filter((id) => this.byId.has(id)));
		this.inner = flow.nodes.filter((node) => this.members.has(node.id));
		this.exits = sectionBoundary(flow, [...this.members]).outgoing;
		this.reads = [
			...flow.nodes.flatMap(readsOf),
			...flow.outputs.flatMap((output) =>
				templateRefs(output.value).map(
					(ref): Read => ({
						reader: { output: output.name },
						name: ref.name,
						path: ref.path,
						self: false,
						rule: false,
					}),
				),
			),
		];
	}

	private inside(reader: SubflowReader): boolean {
		return "node" in reader && this.members.has(reader.node);
	}

	private isOuterNode(name: string): boolean {
		return this.byId.has(name) && !this.members.has(name);
	}

	/** Everything that keeps the Section from becoming a Subflow, before the plan is built. */
	blockers(): SubflowBlocker[] {
		const blockers: SubflowBlocker[] = [];
		const edges = this.flow.edges;

		const stopped = this.inner.filter(
			(node) =>
				node.type === "call" &&
				edges.some((e) => e.from === node.id && e.outcome === "stopped"),
		);
		if (stopped.length > 0)
			blockers.push({
				code: "stopped-edge",
				nodes: stopped.map((node) => node.id),
			});

		const calling = this.inner.filter(
			(node) => node.type === "call" && node.flow === this.options.name,
		);
		if (calling.length > 0)
			blockers.push({
				code: "calls-new-flow",
				nodes: calling.map((node) => node.id),
			});

		for (const exit of this.exits) {
			const group = edges.filter(
				(e) => e.from === exit.from && e.outcome === exit.outcome,
			);
			let countedOutside = false;
			for (const edge of group) {
				if (!this.members.has(edge.to)) {
					if (edge.max !== undefined) countedOutside = true;
				} else if (countedOutside) {
					blockers.push({
						code: "mixed-exit",
						from: exit.from,
						outcome: exit.outcome,
						edges: group.map((e) => e.id),
					});
					break;
				}
			}
		}

		for (const node of this.flow.nodes) {
			const inside = this.members.has(node.id);
			const names = new Set<string>();
			for (const { text } of rulesOf(node)) {
				for (const name of ruleNames(text)) {
					if (inside ? this.isOuterNode(name) : this.members.has(name))
						names.add(name);
				}
				if (inside)
					for (const field of ruleRunFields(text)) names.add(`run.${field}`);
			}
			if (names.size > 0)
				blockers.push({
					code: inside ? "rule-reads-outside" : "rule-reads-inside",
					node: node.id,
					names: [...names],
				});
		}
		return blockers;
	}

	/** The new flow, the caller and the changes. Call only when `blockers()` found none. */
	build(
		sectionId: string,
		sectionLabel: string,
		sectionDescription: string | undefined,
		blockers: SubflowBlocker[],
	): SubflowPlan {
		const { flow, options, entry, members } = this;
		const changes: SubflowChange[] = [];

		// Names of the new flow: its nodes, inputs and variables share one namespace.
		const subTaken = new Set<string>([
			"run",
			"vars",
			...this.inner.map((node) => node.id),
			// Variables keep their names, so rules and templates inside stay.
			...(flow.variables ?? []).map((variable) => variable.name),
		]);
		const callerTaken = new Set<string>([
			"run",
			"vars",
			...flow.nodes.map((node) => node.id),
			...flow.inputs.map((input) => input.name),
			...(flow.variables ?? []).map((variable) => variable.name),
		]);
		const callId = claim(callerTaken, nameFrom(options.name), 40, "_");

		// Inputs: the caller's inputs read inside keep their names.
		const inputs: FlowInputDef[] = [];
		const bindings: Record<string, string> = {};
		const inputChanges = new Map<
			string,
			Extract<SubflowChange, { code: "input-added" }>
		>();
		const addInput = (
			key: string,
			def: FlowInputDef,
			binding: string,
			source: SubflowInputSource,
			reader: string,
		): string => {
			const known = inputChanges.get(key);
			if (known) {
				if (!known.readBy.includes(reader)) known.readBy.push(reader);
				return known.input;
			}
			inputs.push(def);
			bindings[def.name] = binding;
			inputChanges.set(key, {
				kind: "info",
				code: "input-added",
				input: def.name,
				type: def.type,
				source,
				readBy: [reader],
			});
			return def.name;
		};
		const callerInputs = new Map(
			flow.inputs.map((input) => [input.name, input]),
		);
		for (const name of callerInputs.keys()) subTaken.add(name);

		// Variables used inside: read in a template or a rule, or written.
		const variables = new Map(
			(flow.variables ?? []).map((variable) => [variable.name, variable]),
		);
		const usedVars: string[] = [];
		const varUsers = new Map<string, string[]>();
		const useVar = (variable: string, node: string) => {
			if (!variables.has(variable)) return;
			if (!usedVars.includes(variable)) usedVars.push(variable);
			const users = varUsers.get(variable) ?? [];
			if (!users.includes(node)) users.push(node);
			varUsers.set(variable, users);
		};
		const writers = new Map<string, string[]>();
		for (const node of this.inner) {
			for (const write of node.set ?? []) {
				useVar(write.variable, node.id);
				const list = writers.get(write.variable) ?? [];
				if (!list.includes(node.id)) list.push(node.id);
				writers.set(write.variable, list);
			}
		}

		const innerReads = this.reads.filter((read) => this.inside(read.reader));
		const inputOf = new Map<string, string>();
		for (const read of innerReads) {
			const reader = (read.reader as { node: string }).node;
			const [field] = read.path;
			if (read.name === "vars") {
				if (field !== undefined) useVar(field, reader);
				continue;
			}
			if (read.name === "run") {
				if (
					!read.rule &&
					field !== undefined &&
					(CALL_RUN_FIELDS as readonly string[]).includes(field)
				) {
					const key = `run:${field}`;
					const name =
						inputOf.get(key) ?? claim(subTaken, `run_${field}`, 40, "_");
					inputOf.set(
						key,
						addInput(
							key,
							{ name, type: "text" },
							`{{run.${field}}}`,
							{ kind: "run", field: field as CallRunField },
							reader,
						),
					);
				}
				continue;
			}
			const callerInput = callerInputs.get(read.name);
			if (callerInput) {
				const key = `input:${read.name}`;
				inputOf.set(
					key,
					addInput(
						key,
						{
							name: callerInput.name,
							type: callerInput.type,
							...(callerInput.label !== undefined && {
								label: callerInput.label,
							}),
							...(callerInput.description !== undefined && {
								description: callerInput.description,
							}),
						},
						`{{${callerInput.name}}}`,
						{ kind: "input", input: callerInput.name },
						reader,
					),
				);
				continue;
			}
			const source = this.byId.get(read.name);
			if (!source || members.has(read.name) || field === undefined) continue;
			// Rules that read outside are blocked: only templates get here.
			const key = `node:${read.name}.${field}`;
			const name =
				inputOf.get(key) ?? claim(subTaken, `${read.name}_${field}`, 40, "_");
			inputOf.set(
				key,
				addInput(
					key,
					{ name, type: holdsJson(source, field) ? "json" : "text" },
					`{{${read.name}.${field}}}`,
					{ kind: "node", node: read.name, field },
					reader,
				),
			);
		}

		// Each variable used inside starts from an input bound to the caller's value.
		const subVariables: FlowVariableDef[] = [];
		const varInput = new Map<string, string>();
		for (const variable of usedVars) {
			const def = variables.get(variable);
			if (!def) continue;
			const key = `var:${variable}`;
			const name = claim(subTaken, `${variable}_in`, 40, "_");
			// A text variable comes as text (trimmed; no value: ""), the others as JSON.
			const type = def.type === "text" ? "text" : "json";
			for (const user of varUsers.get(variable) ?? []) {
				addInput(
					key,
					{ name, type },
					`{{vars.${variable}}}`,
					{ kind: "variable", variable },
					user,
				);
			}
			varInput.set(variable, name);
			const { initial: _, ...rest } = def;
			subVariables.push({ ...rest, initial: `{{${name}}}` });
		}
		changes.push(...inputChanges.values());

		// Outputs: fields of nodes inside that templates outside read.
		const outputs: FlowOutputDef[] = [];
		const outTaken = new Set<string>(CALL_FIELDS);
		const outputOf = new Map<
			string,
			Extract<SubflowChange, { code: "output-added" }>
		>();
		for (const read of this.reads) {
			if (this.inside(read.reader) || read.rule) continue;
			const [field] = read.path;
			if (!members.has(read.name) || field === undefined) continue;
			const key = `${read.name}.${field}`;
			const known = outputOf.get(key);
			if (known) {
				if (!known.readBy.some((r) => sameReader(r, read.reader)))
					known.readBy.push(read.reader);
				continue;
			}
			const output = claim(outTaken, `${read.name}_${field}`, 40, "_");
			outputs.push({ name: output, value: `{{${read.name}.${field}}}` });
			outputOf.set(key, {
				kind: "info",
				code: "output-added",
				output,
				node: read.name,
				field,
				readBy: [read.reader],
			});
		}
		changes.push(...outputOf.values());

		// Variables written inside go back to the caller through the Call's writes.
		const writeBack: VariableWrite[] = [];
		for (const variable of usedVars) {
			const by = writers.get(variable);
			if (!by) continue;
			const output = claim(outTaken, variable, 40, "_");
			outputs.push({ name: output, value: `{{vars.${variable}}}` });
			writeBack.push({ variable, value: `{{${callId}.${output}}}` });
			changes.push({
				kind: "info",
				code: "variable-written-back",
				variable,
				output,
				writtenBy: by,
			});
		}

		// Ends inside: outcomes without an edge that end the flow as chosen.
		const ends: { node: FlowNode; outcome: string; label: string }[] = [];
		for (const node of this.inner) {
			for (const outcome of nodeOutcomes(node)) {
				const routed = flow.edges.some(
					(e) => e.from === node.id && e.outcome === outcome,
				);
				if (!routed && endsFlow(node, outcome))
					ends.push({ node, outcome, label: endedLabel(node, outcome) });
			}
		}
		const endOptions = uniqueList(
			ends.map((end) => (end.label === "" ? "pass" : end.label)),
		);
		const decided =
			this.exits.length + endOptions.length >= 2 ||
			(this.exits.length === 0 &&
				endOptions.length === 1 &&
				endOptions[0] !== "pass");

		// A label per exit: its outcome when that tells it apart, else node and outcome.
		const labelTaken = new Set<string>([...endOptions, ...reservedOutcomes]);
		const outcomeCount = new Map<string, number>();
		for (const exit of this.exits)
			outcomeCount.set(exit.outcome, (outcomeCount.get(exit.outcome) ?? 0) + 1);
		const exitLabels = this.exits.map((exit) => {
			const own = `${exit.from.replace(/_/g, "-")}-${exit.outcome}`;
			const base =
				outcomeCount.get(exit.outcome) === 1 && !labelTaken.has(exit.outcome)
					? exit.outcome
					: own;
			return claim(labelTaken, base, 30, "-");
		});

		// Positions: the Call where the Section's top left corner was.
		const minX = Math.min(...this.inner.map((node) => node.position.x));
		const minY = Math.min(...this.inner.map((node) => node.position.y));
		const shift = (position: { x: number; y: number }) => ({
			x: position.x - minX,
			y: position.y - minY,
		});

		// End nodes of the new flow, where the Call must tell the exit apart.
		// They go in a column right of every inner node, each level with its
		// node unless the end above is in the way, so none covers a node.
		const endNodes = new Map<string, DecisionNode>();
		const endX =
			Math.max(...this.inner.map((node) => node.position.x)) - minX + STEP_X;
		let endY = Number.NEGATIVE_INFINITY;
		this.exits.forEach((exit, index) => {
			const from = this.byId.get(exit.from);
			const label = exitLabels[index];
			if (!from || label === undefined) return;
			const leadsInside = flow.edges.some(
				(e) =>
					e.from === exit.from &&
					e.outcome === exit.outcome &&
					members.has(e.to),
			);
			if (!decided && endsFlow(from, exit.outcome) && !leadsInside) return;
			const y = Math.max(from.position.y - minY, endY + STEP_Y);
			endY = y;
			const color = outcomeColor(from, exit.outcome);
			endNodes.set(groupKey(exit), {
				id: claim(subTaken, `end_${label.replace(/-/g, "_")}`, 40, "_"),
				type: "decision",
				position: { x: endX, y },
				prompt: "",
				by: "rule",
				decider: "typesafe",
				options: [{ name: label, ...(color !== undefined && { color }) }],
			});
		});

		// The new flow's edges: the ones inside, and one per exit to its end node.
		const subEdges: FlowEdge[] = [];
		const subEdgeIds = new Set(
			flow.edges
				.filter((e) => members.has(e.from) && members.has(e.to))
				.map((e) => e.id),
		);
		const routedEnd = new Set<string>();
		for (const edge of flow.edges) {
			if (!members.has(edge.from)) continue;
			if (members.has(edge.to)) {
				subEdges.push(edge);
				continue;
			}
			const key = `${edge.from}\u0000${edge.outcome}`;
			const end = endNodes.get(key);
			if (!end || routedEnd.has(key)) continue;
			routedEnd.add(key);
			subEdges.push({
				id: claim(
					subEdgeIds,
					`${edge.from}-${edge.outcome}-${end.id}`,
					200,
					"-",
				),
				from: edge.from,
				outcome: edge.outcome,
				to: end.id,
			});
		}

		const subflowDraft: Flow = {
			version: FLOW_VERSION,
			...(sectionDescription !== undefined &&
				sectionDescription.trim() !== "" && {
					description: sectionDescription,
				}),
			inputs,
			outputs,
			...(subVariables.length > 0 && { variables: subVariables }),
			start: entry,
			nodes: [
				...this.inner.map((node) =>
					rewriteTemplates(
						{ ...node, position: shift(node.position) },
						(text) => rewriteInner(text, members, this.byId, inputOf),
					),
				),
				...endNodes.values(),
			],
			edges: subEdges,
		};

		// The caller: the Call (and the Decision) in place of the Section.
		const decisionId = decided
			? claim(callerTaken, `${callId}_ended`, 40, "_")
			: null;
		const call: CallNode = {
			id: callId,
			type: "call",
			...(sectionLabel.trim() !== "" && { label: sectionLabel }),
			position: { x: minX, y: minY },
			flow: options.name,
			inputs: bindings,
			...(writeBack.length > 0 && { set: writeBack }),
		};
		const decisionOptions: Option[] = [
			...this.exits.map((exit, index) => {
				const color = colorOf(this.byId.get(exit.from), exit.outcome);
				return {
					name: exitLabels[index] ?? exit.outcome,
					...(color !== undefined && { color }),
				};
			}),
			...endOptions.map((option) => ({ name: option })),
		].map((option, index, all) =>
			index === all.length - 1
				? option
				: {
						...option,
						when: `${callId}.ended = ${JSON.stringify(option.name)}`,
					},
		);
		const decision: DecisionNode | null =
			decisionId === null
				? null
				: {
						id: decisionId,
						type: "decision",
						position: { x: minX + STEP_X, y: minY },
						prompt: "",
						by: "rule",
						decider: "typesafe",
						options: decisionOptions,
					};

		const rewriteOuter = (text: string) =>
			rewriteRefs(text, (ref) => {
				const [field, ...rest] = ref.path;
				if (!members.has(ref.name) || field === undefined) return undefined;
				const output = outputOf.get(`${ref.name}.${field}`)?.output;
				if (output === undefined) return undefined;
				return `{{${[callId, output, ...rest].join(".")}}}`;
			});
		const firstInner = flow.nodes.findIndex((node) => members.has(node.id));
		const callerNodes: FlowNode[] = [];
		flow.nodes.forEach((node, index) => {
			if (index === firstInner) {
				callerNodes.push(call);
				if (decision) callerNodes.push(decision);
			}
			if (!members.has(node.id))
				callerNodes.push(rewriteTemplates(node, rewriteOuter));
		});

		const exitLabel = new Map(
			this.exits.map((exit, index) => [groupKey(exit), exitLabels[index]]),
		);
		const callerEdgeIds = new Set(flow.edges.map((e) => e.id));
		const callerEdges: FlowEdge[] = [];
		let callEdgeAdded = false;
		const callEdge = (to: string): FlowEdge => ({
			id: claim(callerEdgeIds, `${callId}-pass-${to}`, 200, "-"),
			from: callId,
			outcome: "pass",
			to,
		});
		for (const edge of flow.edges) {
			const fromIn = members.has(edge.from);
			const toIn = members.has(edge.to);
			if (fromIn && toIn) continue;
			if (!fromIn) {
				callerEdges.push(toIn ? { ...edge, to: callId } : edge);
				continue;
			}
			if (decisionId !== null && !callEdgeAdded) {
				callerEdges.push(callEdge(decisionId));
				callEdgeAdded = true;
			}
			const label = exitLabel.get(`${edge.from}\u0000${edge.outcome}`);
			callerEdges.push(
				decisionId === null
					? { ...edge, from: callId, outcome: "pass" }
					: { ...edge, from: decisionId, outcome: label ?? edge.outcome },
			);
		}
		if (decisionId !== null && !callEdgeAdded)
			callerEdges.push(callEdge(decisionId));

		const callerDraft = removeSection(
			{
				...flow,
				start: members.has(flow.start) ? callId : flow.start,
				nodes: callerNodes,
				edges: callerEdges,
				outputs: flow.outputs.map((output) => ({
					...output,
					value: rewriteOuter(output.value),
				})),
			},
			sectionId,
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
		const exitChanges: SubflowChange[] = this.exits.map((exit, index) => ({
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
				nodes: this.inner.map((node) => node.id),
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
		tail.push(...this.differences());

		return {
			ok: true,
			subflow,
			caller,
			callNode: callId,
			decisionNode: decisionId,
			changes: [...head, ...changes, ...tail],
		};
	}

	/**
	 * How a Section the flow can enter again works differently as a
	 * Subflow: each run of the Subflow starts without node values, visits,
	 * loop counts or Agent sessions of earlier passes.
	 */
	private differences(): SubflowChange[] {
		const { flow, members } = this;
		if (!this.reentered()) return [];
		const changes: SubflowChange[] = [];
		const dominators = this.dominators();
		const stale: { node: string; reads: string }[] = [];
		const visits: { node: string; reads: string }[] = [];
		const add = (
			list: { node: string; reads: string }[],
			node: string,
			reads: string,
		) => {
			if (!list.some((r) => r.node === node && r.reads === reads))
				list.push({ node, reads });
		};
		// Outer nodes the run reaches after each exit, before it comes back in.
		const after = new Map(
			this.exits.map((exit) => [
				groupKey(exit),
				this.reachedOutside(exit.edges.map((e) => e.to)),
			]),
		);
		for (const read of this.reads) {
			if (!members.has(read.name)) continue;
			const label = "node" in read.reader ? read.reader.node : null;
			if (read.path[0] === "visit" && label !== null)
				add(visits, label, read.name);
			if (this.inside(read.reader) && label !== null) {
				// The node's own id in a write reads the step that just ended.
				if (read.self && read.name === label) continue;
				const before = dominators.get(label);
				if (read.name === label || !before?.has(read.name))
					add(stale, label, read.name);
				continue;
			}
			if (label === null) continue;
			const missed = this.exits.some(
				(exit) =>
					!dominators.get(exit.from)?.has(read.name) &&
					after.get(groupKey(exit))?.has(label),
			);
			if (missed) add(stale, label, read.name);
		}
		if (stale.length > 0)
			changes.push({
				kind: "differs",
				code: "reads-earlier-pass",
				reads: stale,
			});
		if (visits.length > 0)
			changes.push({ kind: "differs", code: "visit-per-call", reads: visits });
		const limited = flow.edges.filter(
			(e) => members.has(e.from) && members.has(e.to) && e.max !== undefined,
		);
		if (limited.length > 0)
			changes.push({
				kind: "differs",
				code: "loop-limit-per-call",
				edges: limited.map((e) => e.id),
			});
		const sessions = this.inner.filter(
			(node) => node.type === "agent" && node.session === "resume",
		);
		if (sessions.length > 0)
			changes.push({
				kind: "differs",
				code: "session-per-call",
				nodes: sessions.map((node) => node.id),
			});
		return changes;
	}

	/** Whether the run can come back to the Section's entry after it left. */
	private reentered(): boolean {
		const seen = new Set<string>();
		const queue = this.exits.flatMap((exit) => exit.edges.map((e) => e.to));
		for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
			if (id === this.entry) return true;
			if (seen.has(id)) continue;
			seen.add(id);
			for (const edge of this.flow.edges)
				if (edge.from === id) queue.push(edge.to);
		}
		return false;
	}

	/** The outer nodes reachable from `starts` without passing through the Section. */
	private reachedOutside(starts: readonly string[]): Set<string> {
		const seen = new Set<string>();
		const queue = [...starts];
		for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
			if (seen.has(id) || this.members.has(id)) continue;
			seen.add(id);
			for (const edge of this.flow.edges)
				if (edge.from === id) queue.push(edge.to);
		}
		return seen;
	}

	/**
	 * For each node inside, the nodes inside that every path from the entry
	 * to it passes through, itself included (the dominators).
	 */
	private dominators(): Map<string, Set<string>> {
		const ids = this.inner.map((node) => node.id);
		const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
		for (const edge of this.flow.edges) {
			if (this.members.has(edge.from) && this.members.has(edge.to))
				preds.get(edge.to)?.push(edge.from);
		}
		const dom = new Map<string, Set<string>>(
			ids.map((id) => [id, id === this.entry ? new Set([id]) : new Set(ids)]),
		);
		for (let changed = true; changed; ) {
			changed = false;
			for (const id of ids) {
				if (id === this.entry) continue;
				const sets = (preds.get(id) ?? []).map(
					(p) => dom.get(p) ?? new Set<string>(),
				);
				const meet = sets.length
					? new Set(
							[...(sets[0] ?? [])].filter((d) => sets.every((s) => s.has(d))),
						)
					: new Set<string>();
				meet.add(id);
				const old = dom.get(id);
				if (!old || old.size !== meet.size) {
					dom.set(id, meet);
					changed = true;
				}
			}
		}
		return dom;
	}
}

function groupKey(exit: Pick<SectionExit, "from" | "outcome">): string {
	return `${exit.from}\u0000${exit.outcome}`;
}

function colorOf(node: FlowNode | undefined, outcome: string) {
	return node ? outcomeColor(node, outcome) : undefined;
}

function sameReader(a: SubflowReader, b: SubflowReader): boolean {
	return "node" in a
		? "node" in b && a.node === b.node
		: "output" in b && a.output === b.output;
}

/** Whether a node's field holds JSON: `data`, `results`, or a Call's flow output. */
function holdsJson(node: FlowNode, field: string): boolean {
	if ((jsonOutputFields as readonly string[]).includes(field)) return true;
	return node.type === "call" && !node.each && !CALL_FIELDS.includes(field);
}

/**
 * A template inside: a node outside or a run field that differs in a Call
 * reads its input. The caller's inputs keep their names.
 */
function rewriteInner(
	text: string,
	members: ReadonlySet<string>,
	byId: ReadonlyMap<string, FlowNode>,
	inputOf: ReadonlyMap<string, string>,
): string {
	return rewriteRefs(text, (ref: TemplateRef) => {
		const [field, ...rest] = ref.path;
		if (field === undefined) return undefined;
		let input: string | undefined;
		if (ref.name === "run") input = inputOf.get(`run:${field}`);
		else if (byId.has(ref.name) && !members.has(ref.name))
			input = inputOf.get(`node:${ref.name}.${field}`);
		if (input === undefined) return undefined;
		return `{{${[input, ...rest].join(".")}}}`;
	});
}

/** Whether `start` reaches itself along edges without a `max`. */
function loopsBack(flow: Flow, start: string): boolean {
	const seen = new Set<string>();
	const queue = flow.edges
		.filter((e) => e.from === start && e.max === undefined)
		.map((e) => e.to);
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		if (id === start) return true;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const edge of flow.edges)
			if (edge.from === id && edge.max === undefined) queue.push(edge.to);
	}
	return false;
}
