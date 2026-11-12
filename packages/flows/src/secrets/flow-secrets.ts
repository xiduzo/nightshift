import { type Flow, tierNode } from "../flow";
import {
	type CallNode,
	isPersonTier,
	waitSecrets,
	webRequestSecrets,
} from "../nodes";
import { TEMPLATE_REF, templateRefs } from "../template";
import { calledFlow, type ProjectFlowMap } from "../validate";

/**
 * Which secrets a flow uses, known before it runs. The Secrets pages say
 * what uses each secret from it, and a shared flow lists what it needs.
 */

/** Input values known before a run, by name: a literal binding, else a default. */
type Known = ReadonlyMap<string, string>;

/**
 * The text a template renders before a run: each reference must read a
 * known input. Null when only a run knows it (a node's output, `run`, an
 * input the run gets).
 */
function knownText(template: string, known: Known): string | null {
	const readsOnlyKnown = templateRefs(template).every(
		(ref) => ref.path.length === 0 && known.has(ref.name),
	);
	if (!readsOnlyKnown) return null;
	return template.replace(
		TEMPLATE_REF,
		(_raw: string, name: string) => known.get(name) ?? "",
	);
}

/** One run of a flow a Call may start: the flow, and its bindings. */
type CalledRun = { flow: string; inputs: Readonly<Record<string, string>> };

/** Every run a Call may start: its own flow, then each tier of its cascade. */
function callRuns(node: CallNode): CalledRun[] {
	const tiers = (node.cascade ?? []).flatMap((tier, index) => {
		if (isPersonTier(tier)) return [];
		const run = tierNode(node, index);
		return run === null ? [] : [{ flow: run.flow, inputs: run.inputs }];
	});
	return [{ flow: node.flow, inputs: node.inputs }, ...tiers];
}

/**
 * The inputs of a called flow known before a run, as the engine binds them:
 * a binding that renders known text that is not empty, else the default.
 * A binding only a run knows, and the input that takes each element of a
 * list (`each.as`), are not known.
 */
function calledInputs(
	called: Flow,
	run: CalledRun,
	each: string | undefined,
	known: Known,
): Known {
	const values = new Map<string, string>();
	for (const input of called.inputs) {
		if (input.name === each) continue;
		const binding = Object.hasOwn(run.inputs, input.name)
			? run.inputs[input.name]
			: undefined;
		const bound = binding === undefined ? "" : knownText(binding, known);
		if (bound === null) continue;
		if (bound.trim() !== "") values.set(input.name, bound);
		else if (input.default !== undefined && input.default.trim() !== "") {
			values.set(input.name, input.default);
		}
	}
	return values;
}

/** Adds the secrets of `flow` to `found`, and those of the flows it calls. */
function collect(
	flow: Flow,
	known: Known,
	flows: ProjectFlowMap,
	chain: readonly string[],
	found: Set<string>,
): void {
	const add = (names: readonly string[]) => {
		for (const name of names) found.add(name);
	};
	for (const node of flow.nodes) {
		switch (node.type) {
			case "command":
			case "service":
				add(node.secrets ?? []);
				break;
			case "web-request":
				add(webRequestSecrets(node, (text) => knownText(text, known)));
				break;
			case "wait":
				add(waitSecrets(node.until));
				break;
			case "call":
				for (const run of callRuns(node)) {
					// A flow that calls back into its chain adds nothing new.
					if (chain.includes(run.flow)) continue;
					const called = calledFlow(run.flow, flows);
					if (called === undefined) continue;
					collect(
						called,
						calledInputs(called, run, node.each?.as, known),
						flows,
						[...chain, run.flow],
						found,
					);
				}
				break;
		}
	}
}

/**
 * The secrets a flow uses, each name once: those its Command and Service
 * nodes name, each `${NAME}` of a Web request or a Wait for a URL, the
 * secret that holds a Web request's URL, and the secrets of every flow and
 * kit it calls. An input's value is known when a Call binds it to text
 * without a template, else it is its default: so the flow's own defaults
 * count too (`{{webhook}}` with the default `MESSAGE_WEBHOOK_URL`). A secret
 * a run picks from what it reads is not known.
 *
 * `flows`: the project's flow files, for the flows it calls. `name`: the
 * flow's own file name, so that a call back to it adds nothing.
 */
export function flowSecrets(
	flow: Flow,
	options: { flows?: ProjectFlowMap; name?: string } = {},
): string[] {
	const found = new Set<string>();
	const own: CalledRun = { flow: options.name ?? "", inputs: {} };
	collect(
		flow,
		calledInputs(flow, own, undefined, new Map()),
		options.flows ?? {},
		options.name === undefined ? [] : [options.name],
		found,
	);
	return [...found];
}
