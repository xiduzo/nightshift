/**
 * A fake `codex` for tests: `codex exec --experimental-json … [resume <id>]`
 * with the prompt on stdin. Never talks to OpenAI.
 *
 * It appends `{ argv, prompt, config }` as one JSON line to `$FAKE_CODEX_LOG`
 * (`config`: the `--config key=value` pairs), then prints JSONL thread
 * events: `thread.started` (fresh threads only: id `fake-thread`), then for
 * each entry of the JSON array `$FAKE_CODEX_CALLS` an `mcp_tool_call` item on
 * the `tanstack` server around a real MCP `tools/call` to the bridge from
 * `--config mcp_servers.tanstack.*`, an optional pause of
 * `$FAKE_CODEX_SLEEP_MS`, the agent message `$FAKE_CODEX_TEXT` (default
 * `Done.`), and `turn.completed`, or `turn.failed` with the message
 * `$FAKE_CODEX_FAIL` when that is set.
 */
import { appendFileSync } from "node:fs";

type Call = { name: string; arguments: unknown };

const argv = process.argv.slice(2);
const prompt = await Bun.stdin.text();

const config: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
	if (argv[i] !== "--config") continue;
	const pair = argv[i + 1] ?? "";
	const eq = pair.indexOf("=");
	config[pair.slice(0, eq)] = pair.slice(eq + 1);
}
const resumeAt = argv.indexOf("resume");
const resumed = resumeAt >= 0 ? argv[resumeAt + 1] : undefined;

const log = process.env.FAKE_CODEX_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ argv, prompt, config })}\n`);

const print = (event: unknown) =>
	process.stdout.write(`${JSON.stringify(event)}\n`);

function bridge(): { url: string; headers: Record<string, string> } {
	const url = JSON.parse(config["mcp_servers.tanstack.url"] ?? "null");
	if (typeof url !== "string") throw new Error("fake codex: no bridge");
	const headers: Record<string, string> = {};
	const table = config["mcp_servers.tanstack.http_headers"] ?? "";
	for (const match of table.matchAll(/"([^"]+)"\s*=\s*"([^"]*)"/g)) {
		headers[match[1] as string] = match[2] as string;
	}
	return { url, headers };
}

async function callTool(call: Call): Promise<{ text: string; ok: boolean }> {
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
			id: 1,
			method: "tools/call",
			params: { name: call.name, arguments: call.arguments },
		}),
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
	const message = JSON.parse(data ?? "{}");
	if (message.error) return { text: message.error.message, ok: false };
	const text = (message.result?.content ?? [])
		.map((part: { text?: string }) => part.text ?? "")
		.join("");
	return { text, ok: message.result?.isError !== true };
}

if (!resumed) print({ type: "thread.started", thread_id: "fake-thread" });
print({ type: "turn.started" });

const calls: Call[] = JSON.parse(process.env.FAKE_CODEX_CALLS ?? "[]");
let id = 0;
for (const call of calls) {
	const item = {
		id: `item_${++id}`,
		type: "mcp_tool_call",
		server: "tanstack",
		tool: call.name,
		arguments: call.arguments,
	};
	print({ type: "item.started", item: { ...item, status: "in_progress" } });
	const result = await callTool(call);
	print({
		type: "item.completed",
		item: result.ok
			? {
					...item,
					status: "completed",
					result: { content: [{ type: "text", text: result.text }] },
				}
			: { ...item, status: "failed", error: { message: result.text } },
	});
}

const sleepMs = Number(process.env.FAKE_CODEX_SLEEP_MS ?? 0);
if (sleepMs > 0) await Bun.sleep(sleepMs);

const text = process.env.FAKE_CODEX_TEXT ?? "Done.";
const message = { id: `item_${++id}`, type: "agent_message", text };
print({ type: "item.started", item: { ...message, text: "" } });
print({ type: "item.completed", item: message });

const failure = process.env.FAKE_CODEX_FAIL;
print(
	failure
		? { type: "turn.failed", error: { message: failure } }
		: {
				type: "turn.completed",
				usage: {
					input_tokens: 120,
					cached_input_tokens: 100,
					output_tokens: 7,
				},
			},
);
