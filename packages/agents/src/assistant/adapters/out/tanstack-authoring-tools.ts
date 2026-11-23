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
import { flowSchema } from "@nightshift/flows";
import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../../../port";
import { flowJson } from "../../catalog";
import {
	AUTHORING_TOOLS,
	type AuthoringPort,
	errorsOf,
	field,
	flowRows,
	issueLines,
	PROPOSAL_REFUSALS,
	runReport,
} from "../../domain/authoring";

const _TRANSCRIPT_LIMIT = 6_000;
const _STEP_LIMIT = 40;
const _NOTE_LIMIT = 400;

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

export function authoringTools(port: AuthoringPort): BridgedTool[] {
	let refused = 0;
	const tools: BridgedTool[] = [
		toolDefinition({
			name: AUTHORING_TOOLS.getDraft,
			description:
				"The flow the person edits now, as JSON: their draft, saved or not, with the nodes' positions and the Sections. Base every change on it.",
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
				'The profiles a node may name, each on its computer (a Device). Name one in a node as `"profile": { "device": <device>, "profile": <profile> }`, with both ids from this list; the step runs on that computer. An Agent Profile (`kind` agent) is for an Agent node. A Model Profile (`kind` model) is for a Decision or a Value decided by a model. The settings (harness, model, decider) show for this computer\'s profiles only. A node without a profile names the computer its step runs on as `"device": <device>`, by the same id.',
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
				"The CLI tools (an Agent node's `clis`) and connections (its `connections`, a Tool node's `connection`) of this computer. A command calls a CLI tool with a login (`signsIn`) by its name, such as acli-work, to run its program signed in.",
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
				"Check a whole flow as the editor does. Returns its errors and warnings. Fix every error before you propose it, and every warning about a Section.",
			inputSchema: flowInput,
		}).server(async (args: unknown) => {
			const { issues } = await check(port, field(args, "flow"));
			return issueLines(issues);
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.proposeFlow,
			description:
				"Show a new version of the whole flow to the person, who applies or discards it. Keep the ids, positions and Sections of what you do not change: the proposal replaces the draft. A flow with errors is refused: fix them and propose again.",
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
					? runReport(found, draft.flow, "The draft", { cite: true })
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
