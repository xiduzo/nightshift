/**
 * The tools a session gets beyond the harness's own: MCP servers (the
 * client, and the Connections page's test) and CLI tools (programs on this
 * computer, with their help), and Night Shift's own knowledge tools.
 */

export {
	KNOWLEDGE_INDEX_INTRO,
	type KnowledgePort,
	type KnowledgeReadFrom,
	type KnowledgeUse,
	type KnowledgeUseHit,
	knowledgeBrief,
	knowledgeEnv,
	knowledgeTools,
	useHit,
} from "../knowledge";
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
