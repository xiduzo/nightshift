import { afterEach, describe, expect, test } from "bun:test";
import { toolDefinition } from "@tanstack/ai";
import { sharedToolBridgeProvisioner, toolBridgeState } from "./tool-bridge";

const echo = (name: string) =>
	toolDefinition({
		name,
		description: `Answers ${name}`,
		inputSchema: { type: "object", properties: {} },
	}).server(() => `${name} says hi`);

const open: Array<{ close: () => Promise<void> }> = [];

async function provision(tool = "echo", provider = "local-process") {
	const bridge = await sharedToolBridgeProvisioner.provision([echo(tool)], {
		provider,
	});
	open.push(bridge);
	return bridge;
}

afterEach(async () => {
	await Promise.all(open.splice(0).map((b) => b.close()));
});

type Bridge = Awaited<ReturnType<typeof provision>>;

function post(bridge: Bridge, body: unknown, token = bridge.token) {
	return fetch(bridge.url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify(body),
	});
}

const call = (bridge: Bridge, name: string, token?: string) =>
	post(
		bridge,
		{ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name } },
		token,
	);

describe("shared tool bridge", () => {
	test("sessions share one listener, each on its own path", async () => {
		const a = await provision("alpha");
		const b = await provision("beta");
		expect(new URL(a.url).port).toBe(new URL(b.url).port);
		expect(a.url).not.toBe(b.url);
		expect(a.name).toBe("tanstack");

		const response = await call(a, "alpha");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			jsonrpc: "2.0",
			id: 7,
			result: { content: [{ type: "text", text: "alpha says hi" }] },
		});
	});

	test("one session's token never reaches another session's tools", async () => {
		const a = await provision("alpha");
		const b = await provision("beta");
		const response = await call(b, "beta", a.token);
		expect(response.status).toBe(401);
	});

	test("a call after the session closed says the session ended", async () => {
		const a = await provision();
		await a.close();
		const response = await call(a, "echo");
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: { message: string } };
		expect(body.error.message).toContain("session has ended");
	});

	test("speaks the stateless MCP handshake", async () => {
		const a = await provision();
		const init = await post(a, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "t", version: "1" },
			},
		});
		const result = ((await init.json()) as { result: Record<string, unknown> })
			.result;
		expect(result.protocolVersion).toBe("2025-06-18");
		expect(result.capabilities).toEqual({ tools: {} });

		const note = await post(a, {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		expect(note.status).toBe(202);

		const ping = await post(a, { jsonrpc: "2.0", id: 2, method: "ping" });
		expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });

		const list = await post(a, { jsonrpc: "2.0", id: 3, method: "tools/list" });
		const tools = ((await list.json()) as { result: { tools: unknown[] } })
			.result.tools;
		expect(tools).toHaveLength(1);

		const stream = await fetch(a.url, {
			headers: { authorization: `Bearer ${a.token}` },
		});
		expect(stream.status).toBe(405);
	});

	test("answers a batch, leaving out notifications", async () => {
		const a = await provision();
		const response = await post(a, [
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 1, method: "ping" },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
		]);
		const body = (await response.json()) as Array<{ id: number }>;
		expect(body.map((m) => m.id)).toEqual([1, 2]);
	});

	test("a dead listener opens again on the same port", async () => {
		const a = await provision();
		const port = new URL(a.url).port;
		toolBridgeState().server?.stop(true);
		expect(await call(a, "echo").catch(() => "down")).toBe("down");

		// The next session checks the listener first.
		const b = await provision();
		expect(new URL(b.url).port).toBe(port);
		const response = await call(a, "echo");
		expect(response.status).toBe(200);
	});

	test("a Docker sandbox keeps the default per-session bridge", async () => {
		const shared = await provision();
		const docker = await provision("echo", "docker");
		expect(docker.url).toStartWith("http://host.docker.internal:");
		expect(new URL(docker.url).port).not.toBe(new URL(shared.url).port);
	});
});
