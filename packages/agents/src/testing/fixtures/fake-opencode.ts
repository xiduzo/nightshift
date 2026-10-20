/**
 * A fake `opencode` for tests: `opencode serve --hostname=H --port=P` with
 * the subset of the OpenCode 1.x HTTP API that `@tanstack/ai-opencode` uses.
 * Never talks to a model.
 *
 * It prints the ready line, then serves `/event` (server-sent events),
 * `/session` (create), `/session/:id` (get, for resume: known ids are
 * `$FAKE_OPENCODE_SESSIONS`, comma separated), `/session/:id/message` (a
 * prompt turn) and `/session/:id/abort`.
 *
 * A prompt turn replays what OpenCode 1.19 sends (seen live): the user
 * message and its text part, then for each entry of the JSON array
 * `$FAKE_OPENCODE_CALLS` a tool part (pending with an empty input, running,
 * then completed or error) around a real MCP `tools/call` to the bridge from
 * `OPENCODE_CONFIG_CONTENT`, an optional pause of `$FAKE_OPENCODE_SLEEP_MS`,
 * the text `$FAKE_OPENCODE_TEXT` (default `Done.`) as `message.part.delta`
 * events, and the assistant message: with the error `$FAKE_OPENCODE_ERROR`
 * (JSON) when that is set, and the cost `$FAKE_OPENCODE_COST` (default 0.002).
 *
 * It sends `server.heartbeat` events, as OpenCode does.
 *
 * Each prompt appends `{ argv, config, prompt, tools, sessionId }` as one
 * JSON line to `$FAKE_OPENCODE_LOG` (`config`: the parsed
 * `OPENCODE_CONFIG_CONTENT`; `tools`: the bridge's `tools/list`).
 */
import { appendFileSync } from "node:fs";

type Call = { name: string; arguments: unknown };

const argv = process.argv.slice(2);
const flag = (name: string) =>
	argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const hostname = flag("hostname") ?? "127.0.0.1";
const port = Number(flag("port") ?? 4096);
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
const known = new Set(
	(process.env.FAKE_OPENCODE_SESSIONS ?? "").split(",").filter(Boolean),
);

const encoder = new TextEncoder();
const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
let seq = 0;
const nextId = (prefix: string) => `${prefix}_fake_${++seq}`;

function emit(type: string, properties: Record<string, unknown>) {
	const data = encoder.encode(
		`data: ${JSON.stringify({ id: nextId("evt"), type, properties })}\n\n`,
	);
	for (const listener of listeners) listener.enqueue(data);
}

const aborted = new Set<string>();

/** One JSON-RPC request to the tool bridge. */
async function rpc(method: string, params: unknown): Promise<unknown> {
	const bridge = config.mcp?.tanstack;
	if (!bridge) throw new Error("fake opencode: no tanstack bridge");
	const response = await fetch(bridge.url, {
		method: "POST",
		headers: {
			...bridge.headers,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
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

async function prompt(sessionID: string, text: string) {
	const tools = config.mcp?.tanstack
		? (((await rpc("tools/list", {})) as { result?: { tools?: unknown[] } })
				.result?.tools ?? [])
		: undefined;
	const log = process.env.FAKE_OPENCODE_LOG;
	if (log) {
		appendFileSync(
			log,
			`${JSON.stringify({ argv, config, prompt: text, tools, sessionId: sessionID })}\n`,
		);
	}

	const userID = nextId("msg");
	emit("message.updated", {
		sessionID,
		info: { id: userID, role: "user", sessionID },
	});
	// OpenCode echoes the user's text part on the event stream.
	emit("message.part.updated", {
		sessionID,
		part: {
			id: nextId("prt"),
			messageID: userID,
			sessionID,
			type: "text",
			text,
		},
	});
	emit("session.status", { sessionID, status: { type: "busy" } });

	const messageID = nextId("msg");
	const calls: Call[] = JSON.parse(process.env.FAKE_OPENCODE_CALLS ?? "[]");
	for (const call of calls) {
		if (aborted.has(sessionID)) break;
		const callID = nextId("call");
		const part = {
			id: nextId("prt"),
			messageID,
			sessionID,
			type: "tool",
			tool: `tanstack_${call.name}`,
			callID,
		};
		// The first update has no input yet, as OpenCode 1.19 sends it.
		emit("message.part.updated", {
			sessionID,
			part: { ...part, state: { status: "pending", input: {}, raw: "" } },
		});
		emit("message.part.updated", {
			sessionID,
			part: { ...part, state: { status: "running", input: call.arguments } },
		});
		const result = (await rpc("tools/call", {
			name: call.name,
			arguments: call.arguments,
		})) as {
			error?: { message: string };
			result?: { content?: { text?: string }[]; isError?: boolean };
		};
		const output = result.error
			? result.error.message
			: (result.result?.content ?? []).map((c) => c.text ?? "").join("");
		const failed = result.error !== undefined || result.result?.isError;
		emit("message.part.updated", {
			sessionID,
			part: {
				...part,
				state: failed
					? { status: "error", input: call.arguments, error: output }
					: { status: "completed", input: call.arguments, output },
			},
		});
	}

	const sleepMs = Number(process.env.FAKE_OPENCODE_SLEEP_MS ?? 0);
	const until = Date.now() + sleepMs;
	while (Date.now() < until && !aborted.has(sessionID)) await Bun.sleep(20);

	const finalText = process.env.FAKE_OPENCODE_TEXT ?? "Done.";
	const textID = nextId("prt");
	for (const word of finalText.match(/\S+\s*|\s+/g) ?? []) {
		emit("message.part.delta", {
			sessionID,
			messageID,
			partID: textID,
			field: "text",
			delta: word,
		});
	}
	const textPart = {
		id: textID,
		messageID,
		sessionID,
		type: "text",
		text: finalText,
	};
	emit("message.part.updated", { sessionID, part: textPart });

	const error = aborted.has(sessionID)
		? { name: "MessageAbortedError", data: { message: "Aborted" } }
		: process.env.FAKE_OPENCODE_ERROR
			? JSON.parse(process.env.FAKE_OPENCODE_ERROR)
			: undefined;
	const info = {
		id: messageID,
		role: "assistant",
		sessionID,
		cost: Number(process.env.FAKE_OPENCODE_COST ?? 0.002),
		tokens: {
			input: 10,
			output: 5,
			reasoning: 1,
			cache: { read: 100, write: 0 },
		},
		finish: "stop",
		...(error ? { error } : {}),
	};
	emit("message.updated", { sessionID, info });
	emit("session.status", { sessionID, status: { type: "idle" } });
	emit("session.idle", { sessionID });
	// Let the events reach the subscriber first, as they do from OpenCode.
	await Bun.sleep(20);
	return { info, parts: [textPart] };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

Bun.serve({
	hostname,
	port,
	idleTimeout: 0,
	async fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === "/event") {
			let self: ReadableStreamDefaultController<Uint8Array>;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					self = controller;
					listeners.add(controller);
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`,
						),
					);
				},
				cancel() {
					listeners.delete(self);
				},
			});
			return new Response(stream, {
				headers: { "Content-Type": "text/event-stream" },
			});
		}
		if (pathname === "/session" && request.method === "POST") {
			const id = nextId("ses");
			known.add(id);
			return json({ id });
		}
		const match = /^\/session\/([^/]+)(\/[a-z]+)?$/.exec(pathname);
		if (match) {
			const [, id = "", action] = match;
			if (!action && request.method === "GET") {
				return known.has(id) ? json({ id }) : json({ name: "NotFound" }, 404);
			}
			if (action === "/abort") {
				aborted.add(id);
				return json(true);
			}
			if (action === "/message" && request.method === "POST") {
				const body = (await request.json()) as {
					parts: { type: string; text?: string }[];
				};
				const text = body.parts.map((p) => p.text ?? "").join("");
				return json(await prompt(id, text));
			}
		}
		return json({ name: "NotFound" }, 404);
	},
});

// OpenCode sends a heartbeat every few seconds; the adapter's teardown
// waits for the next event.
setInterval(() => emit("server.heartbeat", {}), 300);
console.log(`opencode server listening on http://${hostname}:${port}`);
