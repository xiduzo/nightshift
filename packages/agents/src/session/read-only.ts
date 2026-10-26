/**
 * A read-only session: it reads its working directory but never changes it.
 * The assistant runs this way in a project's Clone.
 *
 * The permission mode is `default` (never `plan`: plan mode on Claude Code
 * runs no bridged tool, so neither the step report nor Night Shift's own
 * tools would work). What `default` means per harness:
 * - Codex: its `read-only` sandbox (the OS stops every write).
 * - OpenCode: only the read permissions are allowed, every other one denied.
 * - Grok Build: a read-only sandbox policy.
 * - ACP agents: every permission request is refused. pi asks for none, so
 *   its harness starts pi with its read tools only.
 * - Claude Code: `default` alone is not enough, because the person's own
 *   allow rules apply: its harness also removes the write and shell tools
 *   (`--disallowedTools`) and loads no MCP server but Night Shift's.
 */
import type { AgentSessionInput } from "../port";

/**
 * The input a harness runs: unchanged without `readOnly`. With it, the
 * permission mode is `default`, and the CLI tools, their launchers and the
 * artifact tool are gone.
 */
export function readOnlyInput(input: AgentSessionInput): AgentSessionInput {
	if (!input.readOnly) return input;
	const {
		clis: _clis,
		toolsPath: _toolsPath,
		saveArtifact: _saveArtifact,
		...rest
	} = input;
	return { ...rest, permissionMode: "default" };
}
