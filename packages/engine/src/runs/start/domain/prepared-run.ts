import type { Flow, FlowNode } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../../../contract";
import type { PlannedNodes, Works } from "./service-devices";

/**
 * What a run starts with once its plan passed every check: its flows,
 * inputs, title and stop time, and the notes it warns about from the
 * start. The checks of a planned run before anything is written, in the
 * order the person sees the refusals (after the plan's own: its Devices,
 * the flow and its called flows, each node's Device and profile):
 *
 * 1. A test run's pins and skips (`test-run.ts`).
 * 2. A run of a project without a folder takes no base (`refuseBaseOfRunFolder`).
 * 3. Each Device has what its nodes need, and a Clone when a node works
 *    in the worktree (`refuseDevice`, once per Device of the plan).
 * 4. One Device per service (`service-devices.ts`).
 * 5. The stop time is ahead, the inputs resolve, and the title
 *    (`preparedRun`).
 */

/** A base for a run of a project without a folder: it has no branches. */
export const NO_BRANCHES =
	"A project without a folder has no branches. Leave Start from empty.";

const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";

/** The title of a run without a flow name: the first Agent prompt, cut short. */
export function quickRunTitle(flow: Flow): string {
	const agent = flow.nodes.find((n) => n.type === "agent");
	const text = (agent?.prompt ?? "").replace(/\s+/g, " ").trim();
	if (!text) return QUICK_RUN_TITLE;
	if (text.length <= TITLE_MAX_CHARS) return text;
	return `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/** Names as a person reads a list of them: "a", "a and b", "a, b and c". */
function listOf(names: readonly string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The note of a run in run folders whose folder steps sit on more than
 * one Device: each has its own folder, with its own files (ADR 22). None
 * when they share one Device.
 */
function runFolderNotes(
	groups: PlannedNodes["groups"],
	works: Works,
): string[] {
	const names = new Map<string, string>();
	for (const { at, nodes } of groups) {
		if (nodes.some((n) => works(n) === "worktree")) {
			names.set(at.id, at.name);
		}
	}
	if (names.size < 2) return [];
	return [
		`The steps of this run work in folders on ${listOf([...names.values()])}. Each device has its own folder, so the files of one are not on the other.`,
	];
}

/** Refuses a base for a run of a project without a folder (ADR 22). */
export function refuseBaseOfRunFolder(
	input: Pick<StartRunInput, "baseRef">,
	runFolder: boolean,
): void {
	if (runFolder && input.baseRef !== undefined) {
		throw new Refusal("invalid", NO_BRANCHES);
	}
}

/**
 * Refuses a Device of the plan that cannot take its nodes: `misfit` is
 * the requirement it fails (null: it has what they need, or it was not
 * asked), and a node that works in the worktree needs a Clone there.
 */
export function refuseDevice(
	group: {
		at: { name: string; hasClone: boolean };
		nodes: readonly FlowNode[];
	},
	misfit: string | null,
	works: Works,
): void {
	if (misfit !== null) throw new Refusal("conflict", misfit);
	const worker = group.nodes.find((n) => works(n) === "worktree");
	if (worker && !group.at.hasClone) {
		throw new Refusal(
			"conflict",
			`The flow runs node "${worker.id}" on ${group.at.name}, but that device does not have this project. Add its folder there first.`,
		);
	}
}

/** A run that passed every check and can start. */
export type PreparedRun<I> = {
	flow: Flow;
	flowName: string | null;
	flowRevision: string | null;
	calledFlows: Record<string, Flow>;
	calledFlowRevisions: Record<string, string>;
	inputs: I;
	title: string;
	stopAt: number | null;
	/** What the run warns about from the start, beyond the plan's notes. */
	notes: string[];
};

/**
 * The last checks of a planned run, and what it starts with: the stop
 * time is ahead of `now`, and the inputs resolve (`resolve` throws the
 * refusal). The title is the flow's name with its text inputs, else the
 * quick run's. A run in run folders (`runFolder`) notes its folders on
 * more than one Device.
 */
export function preparedRun<I extends Record<string, unknown>>(
	input: Pick<StartRunInput, "stopAt" | "inputs">,
	planned: PlannedNodes & {
		flowName: string | null;
		flowRevision: string | null;
		calledFlowRevisions: Record<string, string>;
	},
	facts: {
		now: number;
		runFolder: boolean;
		works: Works;
		resolve(
			declared: NonNullable<Flow["inputs"]>,
			given: StartRunInput["inputs"],
		): I;
	},
): PreparedRun<I> {
	const { flow, flowName, flowRevision, calledFlows, calledFlowRevisions } =
		planned;
	if (input.stopAt !== undefined && input.stopAt <= facts.now) {
		throw new Refusal("invalid", "The stop time has passed already.");
	}
	const inputs = facts.resolve(flow.inputs ?? [], input.inputs);
	const textInputs = (flow.inputs ?? []).flatMap((def) => {
		const value = inputs[def.name];
		return (def.type ?? "text") === "text" &&
			typeof value === "string" &&
			value !== ""
			? [`${def.name} ${value}`]
			: [];
	});
	const title = flowName
		? [flowName, ...textInputs].join(" · ").slice(0, 120)
		: quickRunTitle(flow);
	return {
		flow,
		flowName,
		flowRevision,
		calledFlows,
		calledFlowRevisions,
		inputs,
		title,
		stopAt: input.stopAt ?? null,
		notes: facts.runFolder ? runFolderNotes(planned.groups, facts.works) : [],
	};
}
