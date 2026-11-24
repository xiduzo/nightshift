import type {
	Flow,
	FlowIssue,
	FlowPlace,
	JsonValue,
	ProjectFlowMap,
} from "@nightshift/flows";
import type { KnowledgePort } from "../../knowledge";
import type {
	AuthoringCliTool,
	AuthoringProfile,
	AuthoringSkill,
	AuthoringToolInfo,
} from "../domain/authoring";
import {
	chooseProject,
	knowledgeResourceRow,
	mimeOfKnowledgePath,
	parseKnowledgeUri,
	type TerminalProject,
	type TerminalRunPort,
} from "../terminal";
import type { ToolServerResources } from "./serve-tools";

const READ_BYTES = 1024 * 1024;

/** What the terminal tools read and write: Night Shift on this computer. */
export type TerminalPort = TerminalRunPort &
	KnowledgePort & {
		/** The files of the project's knowledge, as its Space lists them: its MCP resources. */
		knowledgeFiles(
			projectId: string,
		): Promise<{ path: string; size: number }[]>;
		projects(): Promise<TerminalProject[]>;
		flows(projectId: string): Promise<ProjectFlowMap>;
		/** The profiles a node of the project may name, each on its Device. */
		profiles(projectId: string): Promise<AuthoringProfile[]>;
		tools(): Promise<{
			clis: AuthoringCliTool[];
			connections: AuthoringToolInfo[];
		}>;
		skills(projectId: string): Promise<AuthoringSkill[]>;
		/** The place the project's flow `name` is checked in, as the editor checks it. */
		place(projectId: string, name?: string): Promise<FlowPlace>;
		/** Saves the flow as a new revision. Returns its issues as saved. */
		saveFlow(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
		startRun(
			projectId: string,
			flowName: string,
			inputs: Record<string, JsonValue>,
		): Promise<{ id: string; status: string }>;
		/** Where a person opens the flow in Night Shift. */
		flowLink(projectId: string, name: string): string;
	};

export type KnowledgeResourcePort = Pick<KnowledgePort, "readKnowledge"> & {
	projects(): Promise<TerminalProject[]>;
	knowledgeFiles(projectId: string): Promise<{ path: string; size: number }[]>;
};

export const terminalResources = (
	port: KnowledgeResourcePort,
	options: { project?: string | null; folder?: string | null } = {},
): ToolServerResources => ({
	async list() {
		const projects = await port.projects();
		const choice = chooseProject(
			projects,
			options.project?.trim() || null,
			options.folder ?? null,
		);
		const listed = choice.kind === "found" ? [choice.project] : projects;
		const out = [];
		for (const project of listed) {
			for (const file of await port.knowledgeFiles(project.id)) {
				out.push(knowledgeResourceRow(project.id, project.name, file));
			}
		}
		return out;
	},
	async read(uri) {
		const at = parseKnowledgeUri(uri);
		if (!at) return null;
		const file = await port.readKnowledge(at.projectId, at.path, READ_BYTES);
		return file
			? { text: file.text, mimeType: mimeOfKnowledgePath(file.path) }
			: null;
	},
});
