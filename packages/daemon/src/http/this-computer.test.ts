import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { fromThisComputer } from "./this-computer";

const app = new Hono().get("/", (c) =>
	c.text(String(fromThisComputer(c, new Set(["http://localhost:3001"])))),
);

async function local(
	address: string | null,
	options: {
		origin?: string;
		url?: string;
		headers?: Record<string, string>;
	} = {},
) {
	const server = {
		requestIP: () => (address === null ? null : { address }),
	};
	const response = await app.request(
		options.url ?? "http://localhost:3000/",
		{
			headers: {
				...(options.origin ? { origin: options.origin } : {}),
				...options.headers,
			},
		},
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
		expect(await local("127.0.0.1", { origin: "http://localhost:3001" })).toBe(
			true,
		);
		expect(await local("127.0.0.1", { origin: "https://evil.example" })).toBe(
			false,
		);
	});

	test("asks for this computer by a loopback name", async () => {
		expect(await local("127.0.0.1", { url: "http://127.0.0.1:3000/" })).toBe(
			true,
		);
		expect(await local("::1", { url: "http://[::1]:3000/" })).toBe(true);
		// A tunnel that passes the bytes on (frp, rathole): the public name.
		expect(
			await local("127.0.0.1", { url: "https://nightshift.example.com/" }),
		).toBe(false);
	});

	test("never comes through a proxy or a tunnel on this computer", async () => {
		for (const headers of <Record<string, string>[]>[
			{ "x-forwarded-for": "203.0.113.7" },
			{ forwarded: "for=203.0.113.7" },
			{ "x-real-ip": "203.0.113.7" },
			{ "cf-connecting-ip": "203.0.113.7" },
			{ "tailscale-user-login": "someone@example.com" },
			{ "x-forwarded-host": "studio.tail1234.ts.net" },
		]) {
			expect(await local("127.0.0.1", { headers })).toBe(false);
		}
	});

	test("without a server to ask, is not", async () => {
		const response = await app.request("/");
		expect(await response.text()).toBe("false");
	});
});
