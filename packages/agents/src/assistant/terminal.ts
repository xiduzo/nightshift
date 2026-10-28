/**
 * The authoring tools for an agent in a terminal (`nightshift mcp`): the
 * same reads and checks as the chat in the editor, with the same names.
 * In a terminal nobody watches a proposal and no editor holds a draft, so
 * instead of `get_draft` and `propose_flow` the agent saves a checked flow
 * (`save_flow`) and starts a run (`start_run`). The tools read and write
 * through a `TerminalPort`: Night Shift on this computer, over its API.
 *
 * Every tool but `list_projects` works in one project: the `project`
 * argument (an id, a name or a folder), else the one the server started
 * with, else the project whose Clone holds the folder the agent works in.
 */
import {
	type Flow,
	type FlowIssue,
	flowNameSchema,
	flowSchema,
	type JsonValue,
	type ProjectFlowMap,
	proposalIssues,
} from "@nightshift/flows";
import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../port";
import { flowJson } from "./prompts";
import {
	chooseProject,
	projectOfFolder,
	type TerminalProject,
} from "./terminal-project";
import {
	AUTHORING_TOOLS,
	type AuthoringProfile,
	type AuthoringRun,
	type AuthoringSkill,
	type AuthoringToolInfo,
	errorsOf,
	field,
	flowRows,
	issueLines,
	profileRefs,
	runReport,
} from "./tools";

/** A run in the list of `list_runs`. */
export type TerminalRunSummary = {
	id: string;
	flowName: string | null;
	title: string;
	status: string;
	reason: string | null;
	/** Epoch ms. */
	createdAt: number;
};

/** What the terminal tools read and write: Night Shift on this computer. */
export type TerminalPort = {
	projects(): Promise<TerminalProject[]>;
	flows(projectId: string): Promise<ProjectFlowMap>;
	/** The profiles a node of the project may name, each on its Device. */
	profiles(projectId: string): Promise<AuthoringProfile[]>;
	tools(): Promise<{
		clis: AuthoringToolInfo[];
		connections: AuthoringToolInfo[];
	}>;
	skills(projectId: string): Promise<AuthoringSkill[]>;
	/** Saves the flow as a new revision. Returns its issues as saved. */
	saveFlow(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
	startRun(
		projectId: string,
		flowName: string,
		inputs: Record<string, JsonValue>,
	): Promise<{ id: string; status: string }>;
	/** The newest runs of the project first. */
	runs(projectId: string, limit: number): Promise<TerminalRunSummary[]>;
	/** One run of the project, or null when it has no run of that id. */
	run(
		projectId: string,
		runId: string,
	): Promise<{ run: AuthoringRun; flowName: string | null } | null>;
	/** Where a person opens the run in Night Shift. */
	runLink(runId: string): string;
	/** Where a person opens the flow in Night Shift. */
	flowLink(projectId: string, name: string): string;
};

export type TerminalToolOptions = {
	/** The project to work in: an id, a name or a folder. */
	project?: string | null;
	/** The folder the agent works in: the project whose Clone holds it is the default. */
	folder?: string | null;
};

/** The names of the tools only the terminal has. */
export const TERMINAL_TOOLS = {
	listProjects: "list_projects",
	saveFlow: "save_flow",
	startRun: "start_run",
	listRuns: "list_runs",
} as const;

const RUNS_DEFAULT = 10;
const RUNS_MAX = 50;

const projectProperty = {
	type: "string",
	description:
		"The project: its id or name from list_projects. Leave it out for the project of the folder you work in.",
};

const flowProperty = {
	type: "object",
	description: "The whole flow document, version and all.",
};

const projectOnly: Record<string, unknown> = {
	type: "object",
	properties: { project: projectProperty },
};

/** Checks `flow` as the editor does, against the project as it is now. */
async function checkIn(
	port: TerminalPort,
	projectId: string,
	flow: unknown,
	name: string | undefined,
): Promise<FlowIssue[]> {
	const [flows, profiles, tools] = await Promise.all([
		port.flows(projectId),
		port.profiles(projectId),
		port.tools(),
	]);
	// The saved flow of that name is the base: a profile or a connection it
	// names already is no new error. A new flow has no base: no nodes.
	const parsed = flowSchema.safeParse(flow);
	const base =
		(name ? flows[name] : null) ??
		(parsed.success ? { ...parsed.data, nodes: [] } : null);
	// Without a base the flow does not parse, and the check stops before it reads one.
	return proposalIssues(base ?? (flow as Flow), flow, {
		flows,
		name,
		profiles: profileRefs(profiles),
		connections: tools.connections.map((c) => c.name),
	});
}

function inputsOf(value: unknown): Record<string, JsonValue> {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(
			'Give `inputs` as an object of input names and values, for example {"issue": "Fix the login"}.',
		);
	}
	return value as Record<string, JsonValue>;
}

/** The terminal's authoring tools over `port`. */
export function terminalTools(
	port: TerminalPort,
	options: TerminalToolOptions = {},
): BridgedTool[] {
	/** The project of a call. Throws in plain words when there is none. */
	async function projectOf(args: unknown): Promise<TerminalProject> {
		const given = field(args, "project");
		const wanted =
			typeof given === "string" && given.trim() !== ""
				? given.trim()
				: options.project?.trim() || null;
		const choice = chooseProject(
			await port.projects(),
			wanted,
			options.folder ?? null,
		);
		switch (choice.kind) {
			case "found":
				return choice.project;
			case "unknown":
				throw new Error(
					`Night Shift has no project "${choice.wanted}". Call ${TERMINAL_TOOLS.listProjects} for the ids and names.`,
				);
			case "none":
				throw new Error(
					"Night Shift has no projects yet. Add one in Night Shift first.",
				);
			case "ambiguous":
				throw new Error(
					`Name the project in \`project\`. Call ${TERMINAL_TOOLS.listProjects} for the ids and names.`,
				);
		}
	}

	return [
		toolDefinition({
			name: TERMINAL_TOOLS.listProjects,
			description:
				"The projects of Night Shift on this computer: id, name and folder. The other tools take one in `project`.",
			inputSchema: { type: "object", properties: {} },
		}).server(async () => {
			const projects = await port.projects();
			if (projects.length === 0) return "Night Shift has no projects yet.";
			const here = options.folder
				? projectOfFolder(projects, options.folder)
				: undefined;
			return JSON.stringify(
				projects.map((p) => ({ ...p, current: p.id === here?.id })),
				null,
				2,
			);
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.listFlows,
			description:
				"The project's flows: name, description, inputs, outputs and steps. A Subflow (`call`) node can run one of them.",
			inputSchema: projectOnly,
		}).server(async (args: unknown) => {
			const project = await projectOf(args);
			const rows = flowRows(await port.flows(project.id));
			return rows.length > 0
				? JSON.stringify(rows, null, 2)
				: `The project "${project.name}" has no flows yet.`;
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.getFlow,
			description:
				"One flow of the project as Night Shift keeps it, as JSON, by its name: with the nodes' positions and the Sections. To change a flow, start from this and keep what you do not change.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					name: { type: "string", description: "The flow's name." },
				},
				required: ["name"],
			},
		}).server(async (args: unknown) => {
			const name = field(args, "name");
			if (typeof name !== "string" || name.trim() === "") {
				throw new Error("Give the flow's name in `name`.");
			}
			const project = await projectOf(args);
			const flows = await port.flows(project.id);
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
			inputSchema: projectOnly,
		}).server(async (args: unknown) => {
			const project = await projectOf(args);
			const profiles = await port.profiles(project.id);
			return profiles.length > 0
				? JSON.stringify(profiles, null, 2)
				: "None of your computers has a profile yet. Set the harness, model and permission mode on the node.";
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.listTools,
			description:
				"The CLI tools (an Agent node's `clis`) and connections (its `connections`, a Tool node's `connection`) of this computer.",
			inputSchema: { type: "object", properties: {} },
		}).server(async () => JSON.stringify(await port.tools(), null, 2)),
		toolDefinition({
			name: AUTHORING_TOOLS.listSkills,
			description:
				"The skills an Agent node can run with `skill`: the project's own first, then this computer's.",
			inputSchema: projectOnly,
		}).server(async (args: unknown) => {
			const project = await projectOf(args);
			const skills = await port.skills(project.id);
			return skills.length > 0
				? JSON.stringify(skills, null, 2)
				: "No skills are installed.";
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.checkFlow,
			description:
				"Check a whole flow as the editor does. Returns its errors and warnings. Fix every error before you save it, and every warning about a Section.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					flow: flowProperty,
					name: {
						type: "string",
						description:
							"The name you will save it under, so a Subflow node that calls the flow itself is found.",
					},
				},
				required: ["flow"],
			},
		}).server(async (args: unknown) => {
			const project = await projectOf(args);
			const name = field(args, "name");
			const issues = await checkIn(
				port,
				project.id,
				field(args, "flow"),
				typeof name === "string" && name !== "" ? name : undefined,
			);
			return issueLines(issues);
		}),
		toolDefinition({
			name: TERMINAL_TOOLS.saveFlow,
			description:
				"Check a whole flow and save it as the project's flow `name`: a new flow, or a new revision of the flow of that name. The save replaces the whole flow: keep the positions and Sections of what you do not change. A flow with errors is refused: fix them and save again. Save over a flow only when the person asked you to change it.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					name: {
						type: "string",
						description:
							"The flow's name: lowercase letters, digits and -. Example: fix-issue.",
					},
					flow: flowProperty,
				},
				required: ["name", "flow"],
			},
		}).server(async (args: unknown) => {
			const name = flowNameSchema.safeParse(field(args, "name"));
			if (!name.success) {
				throw new Error(
					"Give the flow's name in `name`: lowercase letters, digits and -. Example: fix-issue.",
				);
			}
			const project = await projectOf(args);
			const flow = field(args, "flow");
			const issues = await checkIn(port, project.id, flow, name.data);
			const errors = errorsOf(issues);
			const parsed = flowSchema.safeParse(flow);
			if (errors.length > 0 || !parsed.success) {
				return [
					"Refused: the flow has errors. Fix them, then call save_flow again with the whole flow.",
					"",
					issueLines(errors),
				].join("\n");
			}
			const saved = await port.saveFlow(project.id, name.data, parsed.data);
			const warnings = saved.filter((issue) => issue.severity !== "error");
			return [
				`Saved the flow "${name.data}" in "${project.name}". Open it at ${port.flowLink(project.id, name.data)}`,
				...(warnings.length > 0 ? ["", "Warnings:", issueLines(warnings)] : []),
			].join("\n");
		}),
		toolDefinition({
			name: TERMINAL_TOOLS.startRun,
			description:
				"Start a run of a saved flow of the project on this computer. Returns the run's id and where the person follows it.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					flow: { type: "string", description: "The flow's name." },
					inputs: {
						type: "object",
						description:
							'The values of the flow\'s inputs, by name. Example: {"issue": "Fix the login"}.',
					},
				},
				required: ["flow"],
			},
		}).server(async (args: unknown) => {
			const flow = field(args, "flow");
			if (typeof flow !== "string" || flow.trim() === "") {
				throw new Error("Give the flow's name in `flow`.");
			}
			const inputs = inputsOf(field(args, "inputs"));
			const project = await projectOf(args);
			const run = await port.startRun(project.id, flow, inputs);
			return `Started run ${run.id} of "${flow}" (${run.status}). Follow it at ${port.runLink(run.id)}`;
		}),
		toolDefinition({
			name: TERMINAL_TOOLS.listRuns,
			description:
				"The newest runs of the project: id, flow, title, status and why it ended.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					limit: {
						type: "number",
						description: `At most this many runs. Default ${RUNS_DEFAULT}, at most ${RUNS_MAX}.`,
					},
				},
			},
		}).server(async (args: unknown) => {
			const limit = field(args, "limit");
			const count =
				typeof limit === "number" && Number.isInteger(limit) && limit > 0
					? Math.min(limit, RUNS_MAX)
					: RUNS_DEFAULT;
			const project = await projectOf(args);
			const runs = await port.runs(project.id, count);
			return runs.length > 0
				? JSON.stringify(
						runs.map((run) => ({
							...run,
							createdAt: new Date(run.createdAt).toISOString(),
						})),
						null,
						2,
					)
				: `The project "${project.name}" has no runs yet.`;
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.getRun,
			description:
				"One run of the project: its status, why it ended, its steps with their outcomes and notes, and the end of the failed step's transcript.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					run: {
						type: "string",
						description: "The run's id, from list_runs.",
					},
				},
				required: ["run"],
			},
		}).server(async (args: unknown) => {
			const runId = field(args, "run");
			if (typeof runId !== "string" || runId.trim() === "") {
				throw new Error("Give the run's id in `run`.");
			}
			const project = await projectOf(args);
			const found = await port.run(project.id, runId.trim());
			if (!found) {
				return `The project "${project.name}" has no run ${runId}. Call ${TERMINAL_TOOLS.listRuns} for the ids.`;
			}
			const flows = found.flowName ? await port.flows(project.id) : {};
			const now = found.flowName ? flows[found.flowName] : null;
			return now
				? runReport(found.run, now, `The saved flow "${found.flowName}"`)
				: runReport(found.run, found.run.flow, "The run's own flow");
		}),
	];
}
