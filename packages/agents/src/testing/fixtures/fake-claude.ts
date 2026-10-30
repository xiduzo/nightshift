/**
 * A fake `claude` for tests. Never talks to Anthropic.
 *
 * It appends `{ argv, prompt, tools, mcpConfigs }` as one JSON line to
 * `$FAKE_CLAUDE_LOG` (`tools`: the bridge's `tools/list`, when there is a
 * bridge; `mcpConfigs`: every `--mcp-config` file, parsed), then
 * prints a stream-json session: an init message; each message of the JSON
 * array `$FAKE_CLAUDE_MESSAGES` as it is; for each entry of the JSON
 * array `$FAKE_CLAUDE_CALLS`, a call of that bridged tool over the real MCP
 * bridge from `--mcp-config` (as an assistant `tool_use` plus a user
 * `tool_result`); an optional pause of `$FAKE_CLAUDE_SLEEP_MS`; and a
 * result that costs `$FAKE_CLAUDE_COST_USD` (default 0.0012): successful, or
 * a failure with the text `$FAKE_CLAUDE_RESULT_ERROR` when that is set. A
 * successful result's text is `$FAKE_CLAUDE_RESULT` (default `Done.`).
 */
import { appendFileSync, readFileSync } from "node:fs";

type Call = { name: string; arguments: unknown };

const argv = process.argv.slice(2);
const prompt = await Bun.stdin.text();

const sessionId = "fake-claude-session";
const print = (message: unknown) =>
	process.stdout.write(`${JSON.stringify(message)}\n`);

print({
	type: "system",
	subtype: "init",
	session_id: sessionId,
	model: "fake-model",
	tools: [],
	mcp_servers: [],
});

/** Every `--mcp-config` value (the flag is variadic and may repeat), parsed. */
function mcpConfigs(): { mcpServers: Record<string, unknown> }[] {
	const configs: { mcpServers: Record<string, unknown> }[] = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] !== "--mcp-config") continue;
		for (let j = i + 1; j < argv.length && !argv[j]?.startsWith("-"); j++) {
			configs.push(JSON.parse(readFileSync(argv[j] as string, "utf8")));
		}
	}
	return configs;
}

function bridge(): { url: string; headers: Record<string, string> } {
	for (const config of mcpConfigs()) {
		const server = config.mcpServers.tanstack;
		if (server)
			return server as { url: string; headers: Record<string, string> };
	}
	throw new Error("fake claude: no tanstack bridge in --mcp-config");
}

/** One JSON-RPC request to the bridge; returns the response message. */
async function rpc(
	method: string,
	params: unknown,
	id: number,
): Promise<{
	error?: { message: string };
	result?: {
		content?: { text?: string }[];
		isError?: boolean;
		tools?: unknown[];
	};
}> {
	const { url, headers } = bridge();
	const response = await fetch(url, {
		method: "POST",
		headers: {
			...headers,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});
	const body = await response.text();
	// A bridge answers with JSON or with an SSE stream: the content type says.
	const sse = response.headers
		.get("content-type")
		?.includes("text/event-stream");
	const data = sse
		? body
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.at(-1)
		: body;
	return JSON.parse(data ?? "{}");
}

const configs = mcpConfigs();
const tools = configs.some((config) => config.mcpServers.tanstack)
	? ((await rpc("tools/list", {}, 0)).result?.tools ?? [])
	: undefined;
const log = process.env.FAKE_CLAUDE_LOG;
if (log) {
	appendFileSync(
		log,
		`${JSON.stringify({ argv, prompt, tools, mcpConfigs: configs })}\n`,
	);
}

async function callTool(
	call: Call,
	id: number,
): Promise<{ text: string; isError: boolean }> {
	const message = await rpc(
		"tools/call",
		{ name: call.name, arguments: call.arguments },
		id,
	);
	if (message.error) return { text: message.error.message, isError: true };
	const text = (message.result?.content ?? [])
		.map((part: { text?: string }) => part.text ?? "")
		.join("");
	return { text, isError: message.result?.isError === true };
}

// Recorded stream-json messages (thinking, a subagent's work), printed as they are.
const messages: unknown[] = JSON.parse(
	process.env.FAKE_CLAUDE_MESSAGES ?? "[]",
);
for (const message of messages) print(message);

const calls: Call[] = JSON.parse(process.env.FAKE_CLAUDE_CALLS ?? "[]");
let id = 0;
for (const call of calls) {
	id++;
	const toolUseId = `toolu_fake_${id}`;
	print({
		type: "assistant",
		session_id: sessionId,
		parent_tool_use_id: null,
		message: {
			id: `msg_fake_${id}`,
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: toolUseId,
					name: `mcp__tanstack__${call.name}`,
					input: call.arguments,
				},
			],
		},
	});
	const result = await callTool(call, id);
	print({
		type: "user",
		session_id: sessionId,
		parent_tool_use_id: null,
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					content: result.text,
					is_error: result.isError,
				},
			],
		},
	});
}

const sleepMs = Number(process.env.FAKE_CLAUDE_SLEEP_MS ?? 0);
if (sleepMs > 0) await Bun.sleep(sleepMs);

const resultError = process.env.FAKE_CLAUDE_RESULT_ERROR;
print({
	type: "result",
	subtype: "success",
	is_error: resultError !== undefined,
	result: resultError ?? process.env.FAKE_CLAUDE_RESULT ?? "Done.",
	session_id: sessionId,
	total_cost_usd: Number(process.env.FAKE_CLAUDE_COST_USD ?? 0.0012),
	usage: { input_tokens: 10, output_tokens: 5 },
});
