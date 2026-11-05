import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { hostContract, type PairingRedeemed } from "../contract";
import { isLocalHost } from "./dev-link";
import type { DeviceKeyStore, HostLink, HostLinks } from "./host-links";
import { hostPage, joinHost } from "./join";

/**
 * A Host behind a proxy with its own private authority (Caddy's
 * `tls internal`): its certificate is neither from an authority this
 * computer trusts nor signed by itself, so it cannot be pinned. Joining
 * says so, instead of failing with the TLS error's code.
 */

const openssl = Bun.which("openssl");
const dir = mkdtempSync(join(tmpdir(), "nightshift-join-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]) {
	const made = Bun.spawnSync([openssl as string, ...args], { cwd: dir });
	if (made.exitCode !== 0) throw new Error(made.stderr.toString());
}

/** A leaf for localhost, signed by a private authority that is not sent. */
function privateAuthority() {
	run([
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"2",
		"-keyout",
		"ca.key",
		"-out",
		"ca.pem",
		"-subj",
		"/CN=Private authority",
	]);
	run([
		"req",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		"leaf.key",
		"-out",
		"leaf.csr",
		"-subj",
		"/CN=localhost",
	]);
	Bun.write(join(dir, "san.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1");
	run([
		"x509",
		"-req",
		"-in",
		"leaf.csr",
		"-CA",
		"ca.pem",
		"-CAkey",
		"ca.key",
		"-CAcreateserial",
		"-days",
		"2",
		"-out",
		"leaf.pem",
		"-extfile",
		"san.ext",
	]);
	return {
		cert: readFileSync(join(dir, "leaf.pem"), "utf8"),
		key: readFileSync(join(dir, "leaf.key"), "utf8"),
	};
}

describe("joining a Host", () => {
	test.skipIf(!openssl)(
		"whose certificate cannot be checked says so",
		async () => {
			const tls = privateAuthority();
			const host = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				tls,
				fetch: () => new Response("never"),
			});
			try {
				const progress = joinHost(
					{
						self: { id: "device-b", name: "laptop", platform: "darwin" },
						links: {} as HostLinks,
						keys: {
							kind: "file",
							get: async () => null,
							set: async () => {},
							delete: async () => {},
						},
						started: () => {},
					},
					{ url: `https://localhost:${host.port}`, role: "guest" },
				);
				await expect(progress.next()).rejects.toThrow(
					"This computer cannot check the certificate of the Host.",
				);
			} finally {
				host.stop(true);
			}
		},
	);
});

/**
 * A Host that serves pairing only, on the loopback: it gives a code, and
 * its first answer to the poll is `joined`. It keeps what the joining
 * Device asked for.
 */
function pairingHost(joined: Joined) {
	const asked: { home?: boolean; machine?: string }[] = [];
	const host = implement(hostContract);
	const handler = new RPCHandler({
		pairing: {
			start: host.pairing.start.handler(({ input }) => {
				asked.push({
					home: input.home,
					...(input.machine ? { machine: input.machine } : {}),
				});
				return {
					deviceCode: "device-code",
					userCode: "ABCD1234",
					verificationUri: "http://127.0.0.1/devices",
					verificationUriComplete: "http://127.0.0.1/devices?pair=ABCD1234",
					expiresIn: 600,
					interval: 0,
					fingerprint: null,
				};
			}),
			redeem: host.pairing.redeem.handler(() => joined),
		},
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const { response } = await handler.handle(request, { prefix: "/rpc" });
			return response ?? new Response("Not found", { status: 404 });
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, asked, server };
}

/** Joins the Host at `url` as `role`, and returns every step it yields. */
async function joinSteps(url: string, role: "home" | "guest") {
	const links = {
		home: async () => null,
		save: async (link) => ({ ...link, createdAt: 0, revokedAt: null }),
	} satisfies Pick<HostLinks, "home" | "save">;
	const steps = [];
	for await (const step of joinHost(
		{
			self: { id: "device-b", name: "laptop", platform: "darwin" },
			links,
			keys: {
				kind: "file",
				get: async () => null,
				set: async () => {},
				delete: async () => {},
			},
			started: (_link: HostLink) => {},
			sleep: async () => {},
		},
		{ url, role },
	)) {
		steps.push(step);
	}
	return steps;
}

type Joined = Extract<PairingRedeemed, { status: "joined" }>;

const joinedAnswer: Joined = {
	status: "joined",
	key: "device-key",
	personId: "person-bob",
	host: { id: "host-a", name: "Studio", addresses: [] },
};

describe("joining a Host as its home Host", () => {
	test("asks to be its home Device, and says when the Person is not the Host admin", async () => {
		const host = pairingHost({ ...joinedAnswer, hostAdmin: false });
		try {
			const steps = await joinSteps(host.url, "home");
			expect(host.asked).toEqual([{ home: true }]);
			expect(steps.at(-1)).toEqual({
				kind: "joined",
				hostId: "host-a",
				hostName: "Studio",
				role: "home",
				hostAdmin: false,
			});
		} finally {
			host.server.stop(true);
		}
	});

	test("with a Host of an older version, which does not say who its Host admin is", async () => {
		const host = pairingHost(joinedAnswer);
		try {
			const steps = await joinSteps(host.url, "guest");
			expect(host.asked).toEqual([{ home: false }]);
			expect(steps.at(-1)).toMatchObject({ role: "guest", hostAdmin: null });
		} finally {
			host.server.stop(true);
		}
	});
});

describe("the Host's page for the code", () => {
	test("opens at the address the Host names", () => {
		expect(
			hostPage(
				"https://studio.example.com/devices?pair=ABCD1234",
				"https://studio.example.com",
			),
		).toBe("https://studio.example.com/devices?pair=ABCD1234");
	});

	test("is left out when the Host names its own localhost", () => {
		// A desktop Host: its UI is on its own computer only.
		expect(
			hostPage(
				"http://localhost:3001/devices?pair=ABCD1234",
				"https://studio.example.com",
			),
		).toBeNull();
		expect(
			hostPage("http://127.0.0.1:3001/devices", "https://192.168.1.20"),
		).toBeNull();
	});

	test("stays for a Host on this computer", () => {
		expect(
			hostPage("http://localhost:3001/devices", "http://127.0.0.1:3000"),
		).toBe("http://localhost:3001/devices");
	});

	test("is left out when it is not a web page", () => {
		expect(hostPage("javascript:alert(1)", "https://h.example")).toBeNull();
		expect(hostPage("not a url", "https://h.example")).toBeNull();
	});
});

describe("one computer is one Device", () => {
	const FINGERPRINT = "a".repeat(64);

	/** Joins with this computer's fingerprint, and keeps what happens to the keys and the Device. */
	async function joinWithIdentity(url: string, role: "home" | "guest") {
		const keys: Record<string, string> = {};
		const adopted: [string, number][] = [];
		const started: string[] = [];
		const storeOf = (deviceId: string): DeviceKeyStore => ({
			kind: "file",
			get: async () => null,
			set: async (hostId, key) => {
				keys[`${deviceId}/${hostId}`] = key;
			},
			delete: async () => {},
		});
		const steps = [];
		for await (const step of joinHost(
			{
				self: { id: "device-b", name: "laptop", platform: "darwin" },
				links: {
					home: async () => null,
					save: async (link) => ({ ...link, createdAt: 0, revokedAt: null }),
				},
				keys: storeOf("device-b"),
				started: (link: HostLink) => {
					started.push(link.hostId);
				},
				sleep: async () => {},
				identity: {
					machine: FINGERPRINT,
					keysOf: async (deviceId) => storeOf(deviceId),
					adopt: async (deviceId, walkerSeq) => {
						adopted.push([deviceId, walkerSeq]);
					},
				},
			},
			{ url, role },
		)) {
			steps.push(step);
		}
		return { steps, keys, adopted, started };
	}

	test("a home Host hears the computer's fingerprint; a guest Host does not", async () => {
		const host = pairingHost({ ...joinedAnswer, deviceId: "device-b" });
		try {
			await joinWithIdentity(host.url, "home");
			await joinWithIdentity(host.url, "guest");
			expect(host.asked).toEqual([
				{ home: true, machine: FINGERPRINT },
				{ home: false },
			]);
		} finally {
			host.server.stop(true);
		}
	});

	test("a Host that keeps the Device id: the link starts, and no restart is needed", async () => {
		const host = pairingHost({ ...joinedAnswer, deviceId: "device-b" });
		try {
			const { steps, keys, adopted, started } = await joinWithIdentity(
				host.url,
				"home",
			);
			expect(keys).toEqual({ "device-b/host-a": "device-key" });
			expect(adopted).toEqual([]);
			expect(started).toEqual(["host-a"]);
			expect(steps.at(-1)).not.toHaveProperty("restart");
		} finally {
			host.server.stop(true);
		}
	});

	test("a Host of an older version says no Device id: the install stays as it is", async () => {
		const host = pairingHost(joinedAnswer);
		try {
			const { adopted, started } = await joinWithIdentity(host.url, "home");
			expect(adopted).toEqual([]);
			expect(started).toEqual(["host-a"]);
		} finally {
			host.server.stop(true);
		}
	});

	test("a Host that knows this computer: the key goes under that Device, the link waits for a restart", async () => {
		const host = pairingHost({
			...joinedAnswer,
			deviceId: "first",
			walkerSeq: 42,
		});
		try {
			const { steps, keys, adopted, started } = await joinWithIdentity(
				host.url,
				"home",
			);
			expect(keys).toEqual({ "first/host-a": "device-key" });
			expect(adopted).toEqual([["first", 42]]);
			expect(started).toEqual([]);
			expect(steps.at(-1)).toMatchObject({ kind: "joined", restart: true });
		} finally {
			host.server.stop(true);
		}
	});
});

describe("a development install", () => {
	const dev = (url: string, localOnly: boolean) =>
		joinHost(
			{
				self: { id: "device-b", name: "laptop (dev)", platform: "darwin" },
				links: {
					home: async () => null,
					save: async (link) => ({ ...link, createdAt: 0, revokedAt: null }),
				},
				keys: {
					kind: "file",
					get: async () => null,
					set: async () => {},
					delete: async () => {},
				},
				started: () => {},
				sleep: async () => {},
				localOnly,
			},
			{ url, role: "home" },
		);

	test("refuses a Host on another computer, and says how to allow it", async () => {
		await expect(
			dev("https://nightshift.example.com", true).next(),
		).rejects.toThrow("NIGHTSHIFT_DEV_LINK_HOST=true");
	});

	test("pairs with a Host on this computer", async () => {
		const host = pairingHost(joinedAnswer);
		try {
			const steps = [];
			for await (const step of dev(host.url, true)) steps.push(step);
			expect(steps.at(-1)).toMatchObject({ kind: "joined" });
		} finally {
			host.server.stop(true);
		}
	});
});

describe("isLocalHost", () => {
	test("is true only when every address is on this computer", () => {
		expect(
			isLocalHost(["http://127.0.0.1:3000", "http://localhost:3000"]),
		).toBe(true);
		expect(
			isLocalHost(["http://127.0.0.1:3000", "https://studio.example.com"]),
		).toBe(false);
		expect(isLocalHost(["not an address"])).toBe(false);
		expect(isLocalHost([])).toBe(false);
	});
});
