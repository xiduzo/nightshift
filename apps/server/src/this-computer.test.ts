import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { fromThisComputer } from "./this-computer";

const app = new Hono().get("/", (c) =>
	c.text(String(fromThisComputer(c, new Set(["http://localhost:3001"])))),
);

async function local(address: string | null, origin?: string) {
	const server = {
		requestIP: () => (address === null ? null : { address }),
	};
	const response = await app.request(
		"/",
		{ headers: origin ? { origin } : {} },
		server,
	);
	return (await response.text()) === "true";
}

describe("a request from this computer", () => {
	test("comes from a loopback address", async () => {
		expect(await local("127.0.0.1")).toBe(true);
		expect(await local("::1")).toBe(true);
		expect(await local("::ffff:127.0.0.1")).toBe(true);
		expect(await local("192.168.1.20")).toBe(false);
		expect(await local(null)).toBe(false);
	});

	test("comes from no page, or from Night Shift's own", async () => {
		expect(await local("127.0.0.1", "http://localhost:3001")).toBe(true);
		expect(await local("127.0.0.1", "https://evil.example")).toBe(false);
	});

	test("without a server to ask, is not", async () => {
		const response = await app.request("/");
		expect(await response.text()).toBe("false");
	});
});
