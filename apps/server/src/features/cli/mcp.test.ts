import { describe, expect, test } from "bun:test";
import type { AppRouterClient } from "@nightshift/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { apiPort, mcpOptions } from "./mcp";

describe("nightshift mcp", () => {
	test("the daemon and the links default to this computer", () => {
		expect(mcpOptions([], { PORT: "4100" }, "/work/app")).toEqual({
			daemon: "http://localhost:4100",
			ui: "http://localhost:4100",
			project: null,
			folder: "/work/app",
		});
	});

	test("flags win over the environment; an id stays an id", () => {
		expect(
			mcpOptions(
				[
					"--daemon",
					"http://127.0.0.1:4200/",
					"--ui",
					"http://localhost:3001",
					"--project",
					"p1",
				],
				{ NIGHTSHIFT_DAEMON_URL: "http://localhost:9" },
				"/work/app",
			),
		).toEqual({
			daemon: "http://127.0.0.1:4200",
			ui: "http://localhost:3001",
			project: "p1",
			folder: "/work/app",
		});
		expect(mcpOptions(["--project", "."], {}, process.cwd())?.project).toBe(
			process.cwd(),
		);
		expect(mcpOptions(["--nope"], {}, "/")).toBeNull();
	});

	test("without Night Shift on this computer each tool says so", async () => {
		// A port nothing listens on.
		const server = Bun.serve({ port: 0, fetch: () => new Response() });
		const url = `http://localhost:${server.port}`;
		server.stop(true);
		const client: AppRouterClient = createORPCClient(
			new RPCLink({ url: `${url}/rpc` }),
		);
		const port = apiPort(client, { ui: url });
		await expect(port.projects()).rejects.toThrow(
			"Night Shift is not running on this computer. Start it, then try again.",
		);
		expect(port.runLink("r1")).toBe(`${url}/runs/r1`);
		// A Gate opens at its step.
		expect(port.runLink("r1", "s 1")).toBe(`${url}/runs/r1?step=s%201`);
		await expect(port.gates()).rejects.toThrow(
			"Night Shift is not running on this computer. Start it, then try again.",
		);
	});
});
