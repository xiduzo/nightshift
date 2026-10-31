import type { KnowledgePort } from "../tools";
import type { ToolServerResource, ToolServerResources } from "./mcp";
import { chooseProject, type TerminalProject } from "./terminal-project";

/**
 * The knowledge files as MCP resources (spec 2025-11-25), for `nightshift
 * mcp`: an agent in a terminal can list them and read one without a tool
 * call. The list is the knowledge of the project the server works in (the
 * one it started with, else the folder's), else of every project. A read
 * goes through the same procedure as `read_knowledge`: the Space's
 * knowledge, a PDF or Word file as its text.
 *
 * A resource's URI is `nightshift://knowledge/<project id>/<path>`, each
 * part of the path URI-encoded.
 */

/** The knowledge resources read: what a terminal port gives. */
export type KnowledgeResourcePort = Pick<KnowledgePort, "readKnowledge"> & {
	projects(): Promise<TerminalProject[]>;
	/** The files of the project's knowledge, as its Space lists them. */
	knowledgeFiles(projectId: string): Promise<{ path: string; size: number }[]>;
};

const PREFIX = "nightshift://knowledge/";
/** The most of one file a resource read returns, as the API allows. */
const READ_BYTES = 1024 * 1024;

/** The URI of a file of a project's knowledge. */
export function knowledgeUri(projectId: string, path: string): string {
	return `${PREFIX}${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The project and path of a knowledge URI, or null for another URI. */
function parseUri(uri: string): { projectId: string; path: string } | null {
	if (!uri.startsWith(PREFIX)) return null;
	const [project, ...parts] = uri.slice(PREFIX.length).split("/");
	if (!project || parts.length === 0) return null;
	try {
		return {
			projectId: decodeURIComponent(project),
			path: parts.map(decodeURIComponent).join("/"),
		};
	} catch {
		return null;
	}
}

/** What a read gives: markdown as markdown, any other text, and a document's text, as plain text. */
function mimeOf(path: string): string {
	return /\.(md|markdown|mdx)$/i.test(path) ? "text/markdown" : "text/plain";
}

/** The knowledge resources over `port`, in the project of `options` when there is one. */
export function terminalResources(
	port: KnowledgeResourcePort,
	options: { project?: string | null; folder?: string | null } = {},
): ToolServerResources {
	return {
		async list() {
			const projects = await port.projects();
			const choice = chooseProject(
				projects,
				options.project?.trim() || null,
				options.folder ?? null,
			);
			const listed = choice.kind === "found" ? [choice.project] : projects;
			const out: ToolServerResource[] = [];
			for (const project of listed) {
				for (const file of await port.knowledgeFiles(project.id)) {
					out.push({
						uri: knowledgeUri(project.id, file.path),
						name: file.path,
						title: `${file.path} (${project.name})`,
						description: `A file of the knowledge of "${project.name}".`,
						mimeType: mimeOf(file.path),
						size: file.size,
					});
				}
			}
			return out;
		},
		async read(uri) {
			const at = parseUri(uri);
			if (!at) return null;
			const file = await port.readKnowledge(at.projectId, at.path, READ_BYTES);
			return file ? { text: file.text, mimeType: mimeOf(file.path) } : null;
		},
	};
}
