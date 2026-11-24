/**
 * Data shapes and pure helpers for authoring tools: runs, profiles and flow rows.
 */
import {
	diffFlows,
	type Flow,
	type FlowIssue,
	type FlowPlace,
	type FlowProposal,
	flowDiffSummary,
	type ProjectFlowMap,
	stepCitation,
} from "@nightshift/flows";

export type AuthoringProfile = {
	/** The id of its Device. */
	device: string;
	/** Its id on that Device. */
	profile: string;
	name: string;
	/** Its Device's name: "builder on LE2316". */
	deviceName: string;
	/** `agent` for an Agent node, `model` for a Decision or a Value decided by a model. */
	kind: "agent" | "model";
	description?: string | null;
	harness?: string;
	model?: string;
	decider?: string;
};

/** A CLI tool or a connection, by name. */
export type AuthoringToolInfo = { name: string; description: string | null };

/** A CLI tool: the program it runs (null: the one of its name), and whether it has a login. */
export type AuthoringCliTool = AuthoringToolInfo & {
	program: string | null;
	signsIn: boolean;
};

export type AuthoringSkill = {
	name: string;
	description: string | null;
	/** The project's own skill, or one for every project on this computer. */
	source: "project" | "computer";
};

/** One step of a run, as `get_run` shows it. */
export type AuthoringRunStep = {
	id: string;
	/** The called flow the step ran in (through a Subflow node). Null: the run's own flow. */
	flow: string | null;
	nodeId: string;
	nodeType: string;
	visit: number;
	/** Null while the step runs. */
	outcome: string | null;
	error: string | null;
	/** The step's note or summary, when it has one. */
	note: string | null;
	/** In a test run: the step stood in for its node, and the node did not run. */
	test?: "pinned" | "skipped";
};

/** A run of the flow, for the chat about it. */
export type AuthoringRun = {
	id: string;
	status: string;
	/** Why the run failed, or which label ended it. */
	reason: string | null;
	/** A test run (ADR 27): the nodes its start pinned and skipped, by id. */
	test?: { pinned: string[]; skipped: string[] };
	inputs: Record<string, unknown>;
	/** The copy of the flow the run started from. */
	flow: Flow;
	/** Why that copy does not read: then `flow` has no nodes. Absent: it reads. */
	flowUnread?: string;
	/** In the order they started. */
	steps: AuthoringRunStep[];
	/** The step the run failed or stopped at, or null. Inside a called flow: that step, not its Subflow step. */
	failedStepId: string | null;
	/** The last lines of that step's transcript, oldest first. */
	transcript: string[];
	/**
	 * `so-far`: the step still runs, and `transcript` is what it saved
	 * until now. `cut`: Night Shift could not read all of it. Absent: all
	 * of it.
	 */
	transcriptHolds?: "so-far" | "cut";
};

/**
 * What the authoring tools read and where a proposal goes. The daemon
 * implements it for the chat in the editor; a terminal server can implement
 * it over the project's files.
 */
export type AuthoringPort = {
	/** The flow being edited: its file name and the draft the person sees now. */
	draft(): Promise<{ name: string; flow: Flow }>;
	/** The project's flow files by name: null for a file that does not load. */
	flows(): Promise<ProjectFlowMap>;
	/** This computer's Agent Profiles. */
	profiles(): Promise<AuthoringProfile[]>;
	/** The CLI tools and connections an Agent node may name. */
	tools(): Promise<{
		clis: AuthoringCliTool[];
		connections: AuthoringToolInfo[];
	}>;
	/** The skills an Agent node may run. */
	skills(): Promise<AuthoringSkill[]>;
	/** The place the draft is checked in, as the editor checks it: what its project offers it. */
	place(): Promise<FlowPlace>;
	/** The run the chat is about. Unset: no `get_run` tool. Null: no such run of this flow. */
	run?: () => Promise<AuthoringRun | null>;
	/** Shows a checked proposal to the person. */
	propose(proposal: FlowProposal): void | Promise<void>;
};

/** The tool names, as the skill names them. */
export const AUTHORING_TOOLS = {
	getDraft: "get_draft",
	listFlows: "list_flows",
	getFlow: "get_flow",
	listProfiles: "list_profiles",
	listTools: "list_tools",
	listSkills: "list_skills",
	checkFlow: "check_flow",
	proposeFlow: "propose_flow",
	getRun: "get_run",
} as const;

/** How many times `propose_flow` refuses a flow with errors before it passes it on. */
export const PROPOSAL_REFUSALS = 2;

/** At most this many characters of one run's report for the agent. */
export const RUN_REPORT_LIMIT = 12_000;
const TRANSCRIPT_LIMIT = 6_000;
const STEP_LIMIT = 40;
const NOTE_LIMIT = 400;

export function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The tail of `text`, at most `max` characters. */
function tail(text: string, max: number): string {
	return text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
}

export function issueLines(issues: readonly FlowIssue[]): string {
	if (issues.length === 0) return "No issues.";
	return issues
		.map((issue) => `- ${issue.severity}: ${issue.message}`)
		.join("\n");
}

export const errorsOf = (issues: readonly FlowIssue[]) =>
	issues.filter((issue) => issue.severity === "error");

export function field(args: unknown, key: string): unknown {
	return typeof args === "object" && args !== null
		? (args as Record<string, unknown>)[key]
		: undefined;
}

/** The project's flows in short, for `list_flows`: all but `skip`. */
export function flowRows(flows: ProjectFlowMap, skip?: string) {
	return Object.entries(flows)
		.filter(([name]) => name !== skip)
		.map(([name, flow]) =>
			flow
				? {
						name,
						description: flow.description ?? null,
						inputs: flow.inputs.map((input) => input.name),
						outputs: flow.outputs.map((output) => output.name),
						steps: flow.nodes.length,
					}
				: { name, valid: false },
		);
}

/**
 * What a test run (ADR 27) is, for the agent: which nodes stood in and how.
 * The numbers of Night Shift count only its spend.
 */
function testRunLine(test: { pinned: string[]; skipped: string[] }): string {
	const ids = (nodes: string[]) => nodes.map((id) => `\`${id}\``).join(", ");
	return [
		"Test run: a person started it from the editor. Its pinned and skipped nodes did not run",
		...(test.pinned.length > 0
			? [
					`Pinned (each gave the output of a step of an earlier run): ${ids(test.pinned)}`,
				]
			: []),
		...(test.skipped.length > 0
			? [
					`Skipped (each gave an outcome the person chose): ${ids(test.skipped)}`,
				]
			: []),
		"Only its spend counts in the numbers of the project.",
	].join(". ");
}

/**
 * One run as Markdown for the agent, at most `RUN_REPORT_LIMIT` characters.
 * `draft` is the flow as it is now, which `what` names. With `cite`, each
 * step is the link the chat shows as a citation of it (`stepCitation`).
 */
export function runReport(
	run: AuthoringRun,
	draft: Flow,
	what = "The draft",
	{ cite = false }: { cite?: boolean } = {},
): string {
	const name = (step: AuthoringRunStep) =>
		cite ? stepCitation(step.nodeId, step.id) : `\`${step.nodeId}\``;
	const lines: string[] = [
		`# Run ${run.id}`,
		"",
		`Status: ${run.status}${run.reason ? `. Why: ${cut(run.reason, NOTE_LIMIT)}` : ""}`,
	];
	if (run.test) lines.push(testRunLine(run.test));
	const inputs = JSON.stringify(run.inputs);
	if (inputs !== "{}") lines.push(`Inputs: ${cut(inputs, 1_000)}`);
	const diff = flowDiffSummary(diffFlows(run.flow, draft));
	lines.push(
		run.flowUnread
			? `Another version of Night Shift made the flow this run used, or it is broken (${run.flowUnread}), so it cannot be shown or compared.`
			: diff.empty
				? `${what} is the flow this run used.`
				: `${what} changed since this run: ${diff.added} steps added, ${diff.removed} removed, ${diff.changed} changed, ${diff.edges} edges changed.`,
	);
	lines.push("", "## Steps, in the order they ran");
	if (cite) {
		lines.push(
			"(Each step is a link. To cite a step in your answer, copy its link as written here.)",
		);
	}
	const steps = run.steps.slice(-STEP_LIMIT);
	if (steps.length < run.steps.length) {
		lines.push(`(the last ${steps.length} of ${run.steps.length})`);
	}
	const where = (step: AuthoringRunStep) =>
		step.flow ? ` in the called flow "${step.flow}"` : "";
	for (const step of steps) {
		const parts = [
			`- ${name(step)}${where(step)} (${step.nodeType}${step.visit > 1 ? `, visit ${step.visit}` : ""}): ${step.outcome ?? "running"}`,
		];
		if (step.test) {
			parts.push(
				`${step.test === "pinned" ? "pinned output" : "skipped"}: the node did not run`,
			);
		}
		if (step.error) parts.push(`error: ${cut(step.error, NOTE_LIMIT)}`);
		if (step.note) parts.push(`note: ${cut(step.note, NOTE_LIMIT)}`);
		lines.push(parts.join(". "));
	}
	const failed = run.steps.find((step) => step.id === run.failedStepId);
	if (failed) {
		lines.push(
			"",
			`The step that failed: ${name(failed)}${
				failed.flow
					? ` in the called flow "${failed.flow}". Read it with get_flow: a fix may belong there, or in the Subflow node that calls it`
					: ""
			}.`,
			"",
			`## The end of the transcript of \`${failed.nodeId}\``,
			"",
			...(run.transcriptHolds === "so-far"
				? ["The step still runs: this is what it saved until now.", ""]
				: run.transcriptHolds === "cut"
					? ["Night Shift could not read all of it: this is what it read.", ""]
					: []),
			"```",
			run.transcript.length > 0
				? tail(run.transcript.join("\n"), TRANSCRIPT_LIMIT)
				: "(empty)",
			"```",
		);
	}
	return cut(lines.join("\n"), RUN_REPORT_LIMIT);
}

/**
 * The authoring tools over `port`. Each call of this function counts its
 * own refusals of `propose_flow`: make one set per turn of a chat.
 */
