/**
 * A fake `claude` for tests. Never talks to Anthropic.
 *
 * It appends `{ argv, prompt }` as one JSON line to `$FAKE_CLAUDE_LOG`, then
 * prints a stream-json session: an init message; for each entry of the JSON
 * array `$FAKE_CLAUDE_CALLS`, a call of that bridged tool over the real MCP
 * bridge from `--mcp-config` (as an assistant `tool_use` plus a user
 * `tool_result`); an optional pause of `$FAKE_CLAUDE_SLEEP_MS`; and a
 * successful result that costs `$FAKE_CLAUDE_COST_USD` (default 0.0012).
 */
import { appendFileSync, readFileSync } from "node:fs";

type Call = { name: string; arguments: unknown };

const argv = process.argv.slice(2);
const prompt = await Bun.stdin.text();
const log = process.env.FAKE_CLAUDE_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ argv, prompt })}\n`);

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

function bridge(): { url: string; headers: Record<string, string> } {
	const at = argv.indexOf("--mcp-config");
	const file = at >= 0 ? argv[at + 1] : undefined;
	if (!file) throw new Error("fake claude: no --mcp-config");
	const config = JSON.parse(readFileSync(file, "utf8"));
	const server = Object.values(config.mcpServers)[0] as {
		url: string;
		headers: Record<string, string>;
	};
	return server;
}

async function callTool(
	call: Call,
	id: number,
): Promise<{ text: string; isError: boolean }> {
	const { url, headers } = bridge();
	const response = await fetch(url, {
		method: "POST",
		headers: {
			...headers,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: { name: call.name, arguments: call.arguments },
		}),
	});
	const body = await response.text();
	const data = body.includes("data:")
		? body
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.at(-1)
		: body;
	const message = JSON.parse(data ?? "{}");
	if (message.error) return { text: message.error.message, isError: true };
	const text = (message.result?.content ?? [])
		.map((part: { text?: string }) => part.text ?? "")
		.join("");
	return { text, isError: message.result?.isError === true };
}

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

print({
	type: "result",
	subtype: "success",
	is_error: false,
	result: "Done.",
	session_id: sessionId,
	total_cost_usd: Number(process.env.FAKE_CLAUDE_COST_USD ?? 0.0012),
	usage: { input_tokens: 10, output_tokens: 5 },
});
