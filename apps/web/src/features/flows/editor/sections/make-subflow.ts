// The logic of "Make subflow from section" in the editor: a name to start
// from, the plan for the name the person types, the plan's changes in the
// groups the dialog shows, and the confirm step. `planSubflowFromSection`
// in @nightshift/flows plans; this file has no React.

import {
	type Flow,
	type FlowSection,
	flowNameSchema,
	planSubflowFromSection,
	type SubflowBlocker,
	type SubflowChange,
	type SubflowPlan,
} from "@nightshift/flows";

/** A plan that can go ahead. */
export type ReadySubflowPlan = Extract<SubflowPlan, { ok: true }>;

/** A flow file name is at most 60 characters. */
const NAME_MAX = 60;

/**
 * A flow file name from the Section's label (else its id) that the project
 * does not have: `Code review` → `code-review`, then `code-review-2`, ….
 */
export function subflowNameFor(
	section: Pick<FlowSection, "id" | "label">,
	taken: readonly string[],
): string {
	const slug = (text: string) =>
		text
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, NAME_MAX)
			.replace(/-+$/, "");
	const base = slug(section.label) || slug(section.id) || "subflow";
	const used = new Set(taken);
	let name = base;
	for (let n = 2; used.has(name); n++) {
		const suffix = `-${n}`;
		name = `${base.slice(0, NAME_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
	}
	return name;
}

/** The names of the project's flow files: the other flows and this one. */
export function projectFlowNames(
	flows: Readonly<Record<string, Flow | null>>,
	own: string,
): string[] {
	return [...new Set([...Object.keys(flows), own])];
}

export type SubflowDialogPlan = {
	/** What is wrong with the name: `name-not-valid` or `name-taken`. */
	nameProblem: SubflowBlocker | null;
	/** Everything else that keeps the change from working. */
	blockers: SubflowBlocker[];
	/** The plan to confirm: there is no problem at all. */
	ready: ReadySubflowPlan | null;
	/**
	 * The changes to show. With a name that is not valid or taken, they come
	 * from a free name, so the person still sees what the action does.
	 */
	preview: ReadySubflowPlan | null;
};

const isNameProblem = (blocker: SubflowBlocker) =>
	blocker.code === "name-not-valid" || blocker.code === "name-taken";

/**
 * The plan for the dialog: the Section `sectionId` of `draft` as the flow
 * `name`, checked against the project's other flows (`flows`, without this
 * one) and this flow's own name.
 */
export function planSubflowDialog(
	draft: Flow,
	sectionId: string,
	name: string,
	{
		flows,
		flowName,
	}: { flows: Readonly<Record<string, Flow | null>>; flowName: string },
): SubflowDialogPlan {
	const existingFlowNames = projectFlowNames(flows, flowName);
	const plan = (as: string) =>
		planSubflowFromSection(draft, sectionId, {
			name: as,
			existingFlowNames,
			flows,
			flowName,
		});
	const typed = plan(name);
	if (typed.ok)
		return { nameProblem: null, blockers: [], ready: typed, preview: typed };
	const nameProblem = typed.blockers.find(isNameProblem) ?? null;
	if (nameProblem === null)
		return {
			nameProblem,
			blockers: typed.blockers,
			ready: null,
			preview: null,
		};

	// The planner stops early on a bad name: plan a free one for the rest.
	const section = draft.sections?.find((s) => s.id === sectionId);
	if (!section)
		return {
			nameProblem,
			blockers: typed.blockers,
			ready: null,
			preview: null,
		};
	const free = plan(subflowNameFor(section, existingFlowNames));
	if (free.ok) return { nameProblem, blockers: [], ready: null, preview: free };
	return {
		nameProblem,
		// A Call inside that runs the free name says nothing about the typed one.
		blockers: free.blockers.filter(
			(blocker) => !isNameProblem(blocker) && blocker.code !== "calls-new-flow",
		),
		ready: null,
		preview: null,
	};
}

/** The plan's changes in the order and groups the dialog shows them. */
export type SubflowChangeGroups = {
	/** What works differently afterwards. */
	differs: SubflowChange[];
	/** What moves, what takes its place, where this flow starts. */
	moves: SubflowChange[];
	/** Inputs of the new flow, and its variables, which start from an input. */
	inputs: SubflowChange[];
	/** Outputs of the new flow, and the variables it gives back. */
	outputs: SubflowChange[];
	/** Where the new flow ends and how this flow goes on. */
	exits: SubflowChange[];
};

/** Splits the changes into the dialog's groups. Every change lands in one group. */
export function groupSubflowChanges(
	changes: readonly SubflowChange[],
): SubflowChangeGroups {
	const groups: SubflowChangeGroups = {
		differs: [],
		moves: [],
		inputs: [],
		outputs: [],
		exits: [],
	};
	for (const change of changes) groups[groupOf(change)].push(change);
	return groups;
}

function groupOf(change: SubflowChange): keyof SubflowChangeGroups {
	switch (change.code) {
		case "restarts-on-resume":
		case "reads-earlier-pass":
		case "visit-per-call":
		case "loop-limit-per-call":
		case "session-per-call":
			return "differs";
		case "nodes-moved":
		case "call-added":
		case "start-moved":
		case "section-removed":
			return "moves";
		case "input-added":
			return "inputs";
		case "output-added":
		case "variable-written-back":
			return "outputs";
		case "exit-added":
		case "decision-added":
		case "ends-inside":
			return "exits";
	}
}

/** A Subflow made: the new flow file is saved. */
export type SubflowMade = {
	/** The new flow's file name. */
	name: string;
	/** The new draft of this flow: the Subflow in place of the Section. */
	caller: Flow;
	/** The Subflow node to select. */
	callNode: string;
};

export type MadeSubflow =
	| ({ ok: true } & SubflowMade)
	| { ok: false; message: string };

/** The file name the plan's Subflow runs: the new flow's name. */
export function plannedName(plan: ReadySubflowPlan): string {
	const call = plan.caller.nodes.find((node) => node.id === plan.callNode);
	return call?.type === "call" ? call.flow : "";
}

/**
 * Confirms the plan: writes the new flow file first (`create`), and only
 * when that works gives the new draft of this flow. A failed write leaves
 * the draft as it was. The draft is an edit the person still saves.
 */
export async function makeSubflow(
	plan: ReadySubflowPlan,
	create: (name: string, flow: Flow) => Promise<unknown>,
): Promise<MadeSubflow> {
	const name = plannedName(plan);
	if (!flowNameSchema.safeParse(name).success)
		return { ok: false, message: "The name is not valid." };
	try {
		await create(name, plan.subflow);
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
	return { ok: true, name, caller: plan.caller, callNode: plan.callNode };
}
