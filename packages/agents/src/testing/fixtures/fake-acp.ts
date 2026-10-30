/**
 * A fake ACP agent on stdio, for the ACP harness tests. It speaks the real
 * protocol through `@agentclientprotocol/sdk`. Each prompt streams one text
 * chunk, asks permission to run `npm test`, and, when the client passed an
 * MCP server, calls its `report_step` tool the way a real agent would.
 *
 * `FAKE_ACP_LOG`: a file that gets one JSON line per event (argv, session,
 * prompt, permission, report, config), for the test to read.
 *
 * `FAKE_ACP_CONFIG`: `options` offers the model and a thought level as
 * session config options (as pi-acp and OpenCode 2.x do). A model it does
 * not list is refused.
 *
 * `FAKE_ACP_PLANS`: a JSON array of plans (each an array of plan entries),
 * sent as `plan` updates after the first text chunk.
 * Without an MCP server, the agent reports with a text line instead.
 */
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const logPath = process.env.FAKE_ACP_LOG;
const log = (entry: Record<string, unknown>) => {
	if (logPath) appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
};
log({ type: "argv", argv: process.argv.slice(2) });

type HttpServer = { name: string; url: string; headers: acp.HttpHeader[] };

const servers = new Map<string, HttpServer[]>();

const MODELS = ["fake/default", "ollama/qwen3-coder:latest"];
const offer = process.env.FAKE_ACP_CONFIG;
const plans: acp.PlanEntry[][] = JSON.parse(process.env.FAKE_ACP_PLANS ?? "[]");

/** What a new or loaded session offers, per `FAKE_ACP_CONFIG`. */
function offered(): Partial<acp.NewSessionResponse> {
	if (offer === "options") {
		return {
			configOptions: [
				{
					id: "model",
					name: "Model",
					category: "model",
					type: "select",
					currentValue: "fake/default",
					options: MODELS.map((value) => ({ value, name: value })),
				},
				{
					id: "thinking",
					name: "Thinking",
					category: "thought_level",
					type: "select",
					currentValue: "off",
					options: ["off", "low", "high"].map((value) => ({
						value,
						name: value,
					})),
				},
			],
		};
	}
	return {};
}

/** Announces the MCP call as a tool call, as real agents do, then makes it. */
async function callReport(
	connection: acp.AgentSideConnection,
	sessionId: string,
	server: HttpServer,
): Promise<void> {
	const args = { outcome: "pass", summary: "The tests pass." };
	await connection.sessionUpdate({
		sessionId,
		update: {
			sessionUpdate: "tool_call",
			toolCallId: "report_1",
			title: "report_step",
			kind: "other",
			status: "in_progress",
			rawInput: args,
		},
	});
	const client = new Client({ name: "fake-acp", version: "1.0.0" });
	const headers = Object.fromEntries(
		server.headers.map((h) => [h.name, h.value]),
	);
	await client.connect(
		new StreamableHTTPClientTransport(new URL(server.url), {
			requestInit: { headers },
		}),
	);
	const tools = await client.listTools();
	const name = tools.tools.find((t) => t.name.endsWith("report_step"))?.name;
	if (name) {
		const result = await client.callTool({ name, arguments: args });
		log({ type: "report", isError: result.isError === true });
		await connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "report_1",
				status: result.isError ? "failed" : "completed",
				rawOutput: result.content,
			},
		});
	}
	await client.close();
}

class FakeAgent implements acp.Agent {
	constructor(private connection: acp.AgentSideConnection) {}

	async initialize(): Promise<acp.InitializeResponse> {
		return {
			protocolVersion: acp.PROTOCOL_VERSION,
			agentCapabilities: { loadSession: true },
		};
	}

	async authenticate(): Promise<acp.AuthenticateResponse> {
		log({ type: "authenticate" });
		return {};
	}

	async newSession(
		params: acp.NewSessionRequest,
	): Promise<acp.NewSessionResponse> {
		const sessionId = "fake-session-1";
		this.remember(sessionId, params.mcpServers);
		log({
			type: "session",
			cwd: params.cwd,
			mcp: params.mcpServers.map((s) => s.name),
		});
		return { sessionId, ...offered() };
	}

	async loadSession(
		params: acp.LoadSessionRequest,
	): Promise<acp.LoadSessionResponse> {
		this.remember(params.sessionId, params.mcpServers);
		log({ type: "load", sessionId: params.sessionId });
		return offered();
	}

	async setSessionConfigOption(
		params: acp.SetSessionConfigOptionRequest,
	): Promise<acp.SetSessionConfigOptionResponse> {
		const value = String(params.value);
		log({ type: "config", configId: params.configId, value });
		if (params.configId === "model" && !MODELS.includes(value)) {
			throw acp.RequestError.invalidParams(
				undefined,
				`model not found: ${value}`,
			);
		}
		return { configOptions: offered().configOptions ?? [] };
	}

	private remember(sessionId: string, mcp: acp.McpServer[]) {
		servers.set(
			sessionId,
			mcp.filter((s): s is HttpServer & acp.McpServer => "url" in s),
		);
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const { sessionId } = params;
		log({
			type: "prompt",
			text: params.prompt
				.map((block) => (block.type === "text" ? block.text : ""))
				.join(""),
		});
		await this.connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Running the tests." },
			},
		});
		for (const entries of plans) {
			await this.connection.sessionUpdate({
				sessionId,
				update: { sessionUpdate: "plan", entries },
			});
		}
		const permission = await this.connection.requestPermission({
			sessionId,
			toolCall: { toolCallId: "run_1", title: "npm test", kind: "execute" },
			options: [
				{ optionId: "allow", name: "Allow", kind: "allow_once" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" },
			],
		});
		log({
			type: "permission",
			outcome:
				permission.outcome.outcome === "selected"
					? permission.outcome.optionId
					: "cancelled",
		});
		const bridged = servers.get(sessionId) ?? [];
		for (const server of bridged) {
			await callReport(this.connection, sessionId, server);
		}
		if (bridged.length === 0) {
			await this.connection.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text: `\nNIGHTSHIFT-REPORT: {"outcome": "pass", "summary": "The tests pass."}`,
					},
				},
			});
		}
		return { stopReason: "end_turn" };
	}

	async cancel(): Promise<void> {}
}

const stream = acp.ndJsonStream(
	Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
	Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
new acp.AgentSideConnection((connection) => new FakeAgent(connection), stream);
