import type { Flow, FlowNode } from "../flow";
import { waitSecrets, webRequestSecrets } from "../nodes";
import {
	type CalledFlowsOptions,
	type Known,
	knownText,
	walkCalledFlows,
} from "./called-flows";

/**
 * Which secrets a flow uses, known before it runs. The Secrets pages say
 * what uses each secret from it, and a shared flow lists what it needs.
 */

/** The secrets one node names, with the inputs of its flow known before a run. */
function nodeSecrets(node: FlowNode, known: Known): readonly string[] {
	switch (node.type) {
		case "command":
		case "service":
			return node.secrets ?? [];
		case "web-request":
			return webRequestSecrets(node, (text) => knownText(text, known));
		case "wait":
			return waitSecrets(node.until);
		default:
			return [];
	}
}

/**
 * The secrets a flow uses, each name once: those its Command and Service
 * nodes name, each `${NAME}` of a Web request or a Wait for a URL, the
 * secret that holds a Web request's URL, and the secrets of every flow and
 * kit it calls (`walkCalledFlows`). An input's value is known when a Call
 * binds it to text without a template, else it is its default: so the
 * flow's own defaults count too (`{{webhook}}` with the default
 * `MESSAGE_WEBHOOK_URL`). A secret a run picks from what it reads is not
 * known.
 *
 * `flows`: the project's flow files, for the flows it calls. `name`: the
 * flow's own file name, so that a call back to it adds nothing.
 */
export function flowSecrets(
	flow: Flow,
	options: CalledFlowsOptions = {},
): string[] {
	const found = new Set<string>();
	walkCalledFlows(flow, options, (node, known) => {
		for (const name of nodeSecrets(node, known)) found.add(name);
	});
	return [...found];
}
