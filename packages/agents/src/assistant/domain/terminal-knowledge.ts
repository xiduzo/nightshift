import type { ToolServerResource } from "./mcp";

const PREFIX = "nightshift://knowledge/";

export function knowledgeUri(projectId: string, path: string): string {
	return `${PREFIX}${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function mimeOfKnowledgePath(path: string): string {
	return /\.(md|markdown|mdx)$/i.test(path) ? "text/markdown" : "text/plain";
}

export function parseKnowledgeUri(
	uri: string,
): { projectId: string; path: string } | null {
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

export function knowledgeResourceRow(
	projectId: string,
	projectName: string,
	file: { path: string; size: number },
): ToolServerResource {
	return {
		uri: knowledgeUri(projectId, file.path),
		name: file.path,
		title: `${file.path} (${projectName})`,
		description: `A file of the knowledge of "${projectName}".`,
		mimeType: mimeOfKnowledgePath(file.path),
		size: file.size,
	};
}