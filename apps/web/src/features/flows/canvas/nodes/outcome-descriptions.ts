import {
	commandExits,
	DATA_EXIT_CODE,
	type FlowNode,
	runsEach,
	type WaitUntil,
} from "@nightshift/flows";

/** The descriptions of a node's options, by name, to show beside their handles. */
export function optionDescriptions(
	node: FlowNode,
): Map<string, string | undefined> {
	if (runsEach(node)) {
		return new Map([
			["done", "No item left to start"],
			[
				"halted",
				node.each.haltOn.length > 0
					? `A call ended on ${node.each.haltOn.join(", ")}`
					: undefined,
			],
			["stopped", "The stop time came"],
		]);
	}
	if (node.type === "call") {
		return new Map([
			["pass", "It finished"],
			["fail", "It failed"],
			["stopped", "The stop time came"],
		]);
	}
	if (node.type === "value") {
		return new Map([
			["pass", "The data fits"],
			["fail", "No value made"],
		]);
	}
	if (node.type === "wait") {
		return new Map([
			...(node.outcomes ?? []).map(
				(outcome) =>
					[outcome.name, outcome.description ?? outcome.when] as const,
			),
			["done", WAIT_DONE[node.until.kind]],
			[
				"timeout",
				node.timeoutMinutes
					? `Not within ${node.timeoutMinutes} min`
					: "Never: it has no timeout",
			],
		]);
	}
	if (node.type === "tool") {
		return new Map([
			["pass", "The tool answered"],
			["fail", "It reported an error"],
		]);
	}
	if (node.type === "convert") {
		return new Map([
			["pass", "It converted the value"],
			["fail", "The value does not fit the format"],
		]);
	}
	if (node.type === "web-request") {
		return new Map([
			["pass", "The server answered 2xx"],
			["fail", "Any other answer, or none"],
		]);
	}
	if (node.type === "service") {
		return new Map([
			["ready", "The service is ready"],
			["failed", "It ended, or was not ready in time"],
		]);
	}
	if (node.type === "lease") {
		return new Map([
			["held", "The run holds the lease"],
			[
				"busy",
				node.waitMinutes
					? `Another run holds it after ${node.waitMinutes} min`
					: "Another run holds it",
			],
		]);
	}
	if (node.type === "since-last-run") {
		return new Map([
			["new", node.value === undefined ? "Something is new" : "The first run"],
			["changed", "Something changed"],
			["same", node.value === undefined ? "Nothing new" : "No change"],
		]);
	}
	if (node.type === "join") {
		return new Map([
			[
				"done",
				node.wait === "first"
					? "The first branch arrived"
					: "Every branch arrived",
			],
		]);
	}
	if (node.type === "command") {
		return new Map(
			commandExits(node).map((exit) => [
				exit.name,
				exit.code === undefined
					? "any other exit"
					: exit.code === DATA_EXIT_CODE
						? "picked by the command"
						: `exit ${exit.code}`,
			]),
		);
	}
	const options =
		node.type === "decision"
			? node.options
			: node.type === "agent"
				? (node.outcomes ?? [])
				: [];
	return new Map(options.map((option) => [option.name, option.description]));
}

/** What ends a Wait node as done, by what it waits for. */
const WAIT_DONE: Record<WaitUntil["kind"], string> = {
	duration: "The time is up",
	time: "The time came",
	command: "The command passed",
	signal: "The signal came",
	any: "The signal came, or the command passed",
	url: "The URL answered",
};
