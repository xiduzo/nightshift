/**
 * The assistant's authoring tools: what an agent uses to read and propose a
 * Night Shift flow. A plain list of TanStack AI tool definitions over an
 * `AuthoringPort`, so any transport can serve them: the chat bridges them
 * into a harness session, `nightshift mcp` can serve them to a terminal
 * agent. The names match `skills/nightshift-flows/SKILL.md`.
 *
 * Every tool answers in text (Markdown or JSON) for the agent. None of them
 * writes a file: `propose_flow` hands the flow to the port, which shows it
 * to the person.
 */
import {
	diffFlows,
	type Flow,
	type FlowIssue,
	type FlowProposal,
	flowDiffSummary,
	flowSchema,
	type ProjectFlowMap,
	proposalIssues,
} from "@nightshift/flows";
import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../port";
import { flowJson } from "./prompts";

/**
 * A profile a node may name, as the agent may know it: never its secrets.
 * A node names `{ device, profile }` (ADR 3). The settings are known for
 * this computer's profiles only.
 */
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

/** The pairs a node may name, for the flow check. */
export function profileRefs(
	profiles: readonly AuthoringProfile[],
): { device: string; profile: string }[] {
	return profiles.map(({ device, profile }) => ({ device, profile }));
}

/** A CLI tool or a connection, by name. */
export type AuthoringToolInfo = { name: string; description: string | null };

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
};

/** A run of the flow, for the chat about it. */
export type AuthoringRun = {
	id: string;
	status: string;
	/** Why the run failed, or which label ended it. */
	reason: string | null;
	inputs: Record<string, unknown>;
	/** The copy of the flow the run started from. */
	flow: Flow;
	/** In the order they started. */
	steps: AuthoringRunStep[];
	/** The step the run failed or stopped at, or null. Inside a called flow: that step, not its Subflow step. */
	failedStepId: string | null;
	/** The last lines of that step's transcript, oldest first. */
	transcript: string[];
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
		clis: AuthoringToolInfo[];
		connections: AuthoringToolInfo[];
	}>;
	/** The skills an Agent node may run. */
	skills(): Promise<AuthoringSkill[]>;
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

const noInput: Record<string, unknown> = {
	type: "object",
	properties: {},
	additionalProperties: false,
};

const flowProperty = {
	type: "object",
	description: "The whole flow document, version and all.",
};

const flowInput: Record<string, unknown> = {
	type: "object",
	properties: { flow: flowProperty },
	required: ["flow"],
};

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

/** The issues of a flow the agent wrote, checked as the editor checks it. */
async function check(port: AuthoringPort, flow: unknown) {
	const [draft, flows, profiles, tools] = await Promise.all([
		port.draft(),
		port.flows(),
		port.profiles(),
		port.tools(),
	]);
	const issues = proposalIssues(draft.flow, flow, {
		flows,
		name: draft.name,
		profiles: profileRefs(profiles),
		connections: tools.connections.map((c) => c.name),
	});
	return { draft, issues };
}

/**
 * One run as Markdown for the agent, at most `RUN_REPORT_LIMIT` characters.
 * `draft` is the flow as it is now, which `what` names.
 */
export function runReport(
	run: AuthoringRun,
	draft: Flow,
	what = "The draft",
): string {
	const lines: string[] = [
		`# Run ${run.id}`,
		"",
		`Status: ${run.status}${run.reason ? `. Why: ${cut(run.reason, NOTE_LIMIT)}` : ""}`,
	];
	const inputs = JSON.stringify(run.inputs);
	if (inputs !== "{}") lines.push(`Inputs: ${cut(inputs, 1_000)}`);
	const diff = flowDiffSummary(diffFlows(run.flow, draft));
	lines.push(
		diff.empty
			? `${what} is the flow this run used.`
			: `${what} changed since this run: ${diff.added} steps added, ${diff.removed} removed, ${diff.changed} changed, ${diff.edges} edges changed.`,
	);
	lines.push("", "## Steps, in the order they ran");
	const steps = run.steps.slice(-STEP_LIMIT);
	if (steps.length < run.steps.length) {
		lines.push(`(the last ${steps.length} of ${run.steps.length})`);
	}
	const where = (step: AuthoringRunStep) =>
		step.flow ? ` in the called flow "${step.flow}"` : "";
	for (const step of steps) {
		const parts = [
			`- \`${step.nodeId}\`${where(step)} (${step.nodeType}${step.visit > 1 ? `, visit ${step.visit}` : ""}): ${step.outcome ?? "running"}`,
		];
		if (step.error) parts.push(`error: ${cut(step.error, NOTE_LIMIT)}`);
		if (step.note) parts.push(`note: ${cut(step.note, NOTE_LIMIT)}`);
		lines.push(parts.join(". "));
	}
	const failed = run.steps.find((step) => step.id === run.failedStepId);
	if (failed) {
		lines.push(
			"",
			`The step that failed: \`${failed.nodeId}\`${
				failed.flow
					? ` in the called flow "${failed.flow}". Read it with get_flow: a fix may belong there, or in the Subflow node that calls it`
					: ""
			}.`,
			"",
			`## The end of the transcript of \`${failed.nodeId}\``,
			"",
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
export function authoringTools(port: AuthoringPort): BridgedTool[] {
	let refused = 0;
	const tools: BridgedTool[] = [
		toolDefinition({
			name: AUTHORING_TOOLS.getDraft,
			description:
				"The flow the person edits now, as JSON: their draft, saved or not. Base every change on it.",
			inputSchema: noInput,
		}).server(async () => {
			const draft = await port.draft();
			return `The flow "${draft.name}":\n\n${flowJson(draft.flow)}`;
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.listFlows,
			description:
				"The project's other flows: name, description, inputs and steps. A Subflow (`call`) node can run one of them.",
			inputSchema: noInput,
		}).server(async () => {
			const [draft, flows] = await Promise.all([port.draft(), port.flows()]);
			const rows = flowRows(flows, draft.name);
			return rows.length > 0
				? JSON.stringify(rows, null, 2)
				: "The project has no other flows.";
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.getFlow,
			description: "One flow of the project as JSON, by its name.",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", description: "The flow's name." },
				},
				required: ["name"],
			},
		}).server(async (args: unknown) => {
			const name = field(args, "name");
			if (typeof name !== "string" || name.trim() === "") {
				throw new Error("Give the flow's name in `name`.");
			}
			const flows = await port.flows();
			if (!(name in flows)) {
				return `The project has no flow "${name}". Call ${AUTHORING_TOOLS.listFlows} for the names.`;
			}
			const flow = flows[name];
			return flow
				? flowJson(flow)
				: `The flow "${name}" is not valid: it does not load.`;
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.listProfiles,
			description:
				'The profiles a node may name, each on its computer (a Device). Name one in a node as `"profile": { "device": <device>, "profile": <profile> }`, with both ids from this list; the step runs on that computer. An Agent Profile (`kind` agent) is for an Agent node. A Model Profile (`kind` model) is for a Decision or a Value decided by a model. The settings (harness, model, decider) show for this computer\'s profiles only.',
			inputSchema: noInput,
		}).server(async () => {
			const profiles = await port.profiles();
			return profiles.length > 0
				? JSON.stringify(profiles, null, 2)
				: "None of your computers has a profile yet. Set the harness, model and permission mode on the node.";
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.listTools,
			description:
				"The CLI tools (an Agent node's `clis`) and connections (its `connections`, a Tool node's `connection`) of this computer.",
			inputSchema: noInput,
		}).server(async () => JSON.stringify(await port.tools(), null, 2)),
		toolDefinition({
			name: AUTHORING_TOOLS.listSkills,
			description:
				"The skills an Agent node can run with `skill`: the project's own first, then this computer's.",
			inputSchema: noInput,
		}).server(async () => {
			const skills = await port.skills();
			return skills.length > 0
				? JSON.stringify(skills, null, 2)
				: "No skills are installed.";
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.checkFlow,
			description:
				"Check a whole flow as the editor does. Returns its errors and warnings. Fix every error before you propose it.",
			inputSchema: flowInput,
		}).server(async (args: unknown) => {
			const { issues } = await check(port, field(args, "flow"));
			return issueLines(issues);
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.proposeFlow,
			description:
				"Show a new version of the whole flow to the person, who applies or discards it. Keep the ids of what you do not change. A flow with errors is refused: fix them and propose again.",
			inputSchema: {
				type: "object",
				properties: {
					flow: flowProperty,
					summary: {
						type: "string",
						description:
							"One or two plain sentences for the person: what changes and why.",
					},
				},
				required: ["flow", "summary"],
			},
		}).server(async (args: unknown) => {
			const flow = field(args, "flow");
			const summary = field(args, "summary");
			const { issues } = await check(port, flow);
			const errors = errorsOf(issues);
			if (errors.length > 0 && refused < PROPOSAL_REFUSALS) {
				refused += 1;
				return [
					"Refused: the flow has errors. Fix them, then call propose_flow again with the whole flow.",
					"",
					issueLines(errors),
				].join("\n");
			}
			const parsed = flowSchema.safeParse(flow);
			if (!parsed.success) {
				return [
					"Refused: the flow does not match the flow format, so the person cannot see it. Fix these problems:",
					"",
					issueLines(errors),
				].join("\n");
			}
			refused = 0;
			await port.propose({
				flow: parsed.data,
				summary:
					typeof summary === "string" && summary.trim() !== ""
						? summary.trim()
						: "A new version of the flow.",
				issues,
			});
			return [
				errors.length > 0
					? "The person sees your proposal now, with its errors marked."
					: "The person sees your proposal now.",
				"End your turn with a short message: what you changed and why. Do not repeat the JSON.",
			].join(" ");
		}),
	];
	const { run } = port;
	if (run) {
		tools.push(
			toolDefinition({
				name: AUTHORING_TOOLS.getRun,
				description:
					"The run this chat is about: its status, why it ended, its steps with their outcomes and notes, and the end of the failed step's transcript.",
				inputSchema: noInput,
			}).server(async () => {
				const [found, draft] = await Promise.all([run(), port.draft()]);
				return found
					? runReport(found, draft.flow)
					: "This run is not one of this flow's runs on this computer.";
			}),
		);
	}
	return tools;
}

/** The activity line of a call of an authoring tool, in plain words. */
export function describeAuthoringTool(name: string): string | undefined {
	switch (name) {
		case AUTHORING_TOOLS.getDraft:
			return "Reads your flow";
		case AUTHORING_TOOLS.listFlows:
		case AUTHORING_TOOLS.getFlow:
			return "Reads the project's flows";
		case AUTHORING_TOOLS.listProfiles:
			return "Looks at the profiles";
		case AUTHORING_TOOLS.listTools:
			return "Looks at the CLI tools and connections";
		case AUTHORING_TOOLS.listSkills:
			return "Looks at the skills";
		case AUTHORING_TOOLS.checkFlow:
			return "Checks the flow";
		case AUTHORING_TOOLS.proposeFlow:
			return "Proposes a new version of the flow";
		case AUTHORING_TOOLS.getRun:
			return "Reads the run";
		default:
			return undefined;
	}
}
