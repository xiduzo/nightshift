import type { KnowledgePort } from "../../knowledge";
import {
	chooseProject,
	knowledgeResourceRow,
	mimeOfKnowledgePath,
	parseKnowledgeUri,
	type TerminalProject,
} from "../terminal";
import type { ToolServerResources } from "./serve-tools";

const READ_BYTES = 1024 * 1024;

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
