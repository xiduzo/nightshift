/**
 * The tools a session gets beyond the harness's own: MCP servers (the
 * client, and the Connections page's test) and CLI tools (programs on this
 * computer, with their help). The knowledge tools have their own entry,
 * `./knowledge`: `asBridgedTools` makes its specs the tools a session takes.
 */

export { asBridgedTools } from "./bridged-tools";
export {
	type CliToolCheck,
	checkCli,
	cliHelp,
	pathPrograms,
} from "./cli-tools";
export {
	callMcpTool,
	MCP_TIMEOUT_MS,
	type McpToolCall,
	type McpToolInfo,
	toolInfo,
	withMcpClient,
} from "./mcp";
export { type McpTestResult, testMcpServer } from "./mcp-test";
