import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { hostOrigin } from "../links/join";
import {
	LISTEN_HOSTNAME,
	listenHostname,
	parseListen,
	reachFor,
} from "./reach";

describe("secure by default", () => {
	test("a daemon answers this computer only, until it is a Host with an https:// address", () => {
		expect(reachFor({ host: false, hostAddresses: [] })).toBe("this-computer");
		expect(
			reachFor({ host: false, hostAddresses: ["https://studio.example.com"] }),
		).toBe("this-computer");
		expect(
			reachFor({ host: true, hostAddresses: ["http://localhost:3000"] }),
		).toBe("this-computer");
		expect(
			reachFor({
				host: true,
				hostAddresses: ["http://localhost:3000", "https://studio.local"],
			}),
		).toBe("network");
		expect(LISTEN_HOSTNAME["this-computer"]).toBe("127.0.0.1");
	});

	test("a Host listens on every network, or where NIGHTSHIFT_LISTEN says", () => {
		expect(listenHostname("network", parseListen(undefined))).toBe("0.0.0.0");
		expect(listenHostname("network", parseListen(" 127.0.0.1 "))).toBe(
			"127.0.0.1",
		);
		expect(listenHostname("network", parseListen(" "))).toBe("0.0.0.0");
		// Not a Host: the loopback, whatever NIGHTSHIFT_LISTEN says.
		expect(listenHostname("this-computer", parseListen("0.0.0.0"))).toBe(
			"127.0.0.1",
		);
	});

	test("join addresses are https://, or http:// on this computer", () => {
		expect(hostOrigin("https://studio.example.com/devices")).toBe(
			"https://studio.example.com",
		);
		expect(hostOrigin("studio.example.com")).toBe("https://studio.example.com");
		expect(hostOrigin("http://localhost:3000")).toBe("http://localhost:3000");
		expect(hostOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
		expect(() => hostOrigin("http://studio.example.com")).toThrow(/https:\/\//);
		expect(() => hostOrigin("http://192.168.1.20:3000")).toThrow(/https:\/\//);
	});
});

describe("where a Host may listen (NIGHTSHIFT_LISTEN, --listen)", () => {
	test("an IP address, localhost or a host name, as written", () => {
		for (const listen of [
			"127.0.0.1",
			"0.0.0.0",
			"192.168.1.20",
			"::",
			"::1",
			"[::1]",
			"[::]",
			"fd7a:115c:a1e0::1",
			"::ffff:127.0.0.1",
			"fe80::1%lo0",
			"[fe80::1%lo0]",
			"localhost",
			"LOCALHOST",
			"studio",
			"studio.lan",
			"nightshift-host.example.com",
			"nightshift.example.com.",
			"127.1",
			`${"a".repeat(63)}.example.com`,
			// 253 characters: the longest a host name may be.
			`${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
		]) {
			expect<string | null>(parseListen(listen)).toBe(listen);
		}
	});

	test("blank is the default", () => {
		for (const blank of [undefined, null, "", "  "]) {
			expect(parseListen(blank)).toBeNull();
		}
	});

	test("anything else is refused, with words for the person", () => {
		for (const wrong of [
			"127.0.0.1:3000",
			"localhost:3000",
			"[::1]:3000",
			":::",
			":::1",
			"[::1",
			"::1]",
			"[127.0.0.1]",
			"[localhost]",
			"http://127.0.0.1",
			"https://nightshift.example.com",
			"127.0.0.1/24",
			"studio lan",
			"studio_lan",
			"-studio",
			"studio-",
			"studio..lan",
			".studio",
			"fe80::1%",
			`${"a".repeat(64)}.example.com`,
			`${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
		]) {
			let refused: unknown;
			try {
				parseListen(wrong);
			} catch (error) {
				refused = error;
			}
			expect(refused).toBeInstanceOf(Refusal);
			expect((refused as Refusal).kind).toBe("invalid");
			expect((refused as Refusal).message).toBe(
				`${wrong} is not an address to listen on. Use an IP address or a host name, for example 127.0.0.1.`,
			);
		}
	});
});

// The loopback interface has a link-local address with this name on macOS.
test.skipIf(process.platform !== "darwin")(
	"an IPv6 address with a zone binds, as written",
	() => {
		for (const listen of ["fe80::1%lo0", "[fe80::1%lo0]"]) {
			const server = Bun.serve({
				hostname: listenHostname("network", parseListen(listen)),
				port: 0,
				fetch: () => new Response("OK"),
			});
			expect(server.port).toBeGreaterThan(0);
			server.stop(true);
		}
	},
);
