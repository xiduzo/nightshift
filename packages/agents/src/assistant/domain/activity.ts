/** The tool's own name: without an MCP server prefix. */
export function bareToolName(name: string): string {
	const mcp = /^mcp__.+?__(.+)$/.exec(name);
	const bare = mcp?.[1] ?? name.replace(/^tanstack_/, "");
	return bare.toLowerCase();
}