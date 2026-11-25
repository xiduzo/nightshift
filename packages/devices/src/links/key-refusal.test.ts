import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wireDeviceKeys } from "@nightshift/auth";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";
import type { SettingsStore } from "@nightshift/engine/settings";
import {
	createRunBus,
	createRunHistory,
	createRunLog,
	deviceRowsOn,
} from "@nightshift/engine/testing";
import { now } from "@nightshift/time";
import { RPCHandler } from "@orpc/server/fetch";
import { askedHostOf, deviceVersionOf, HOST_HEADER } from "../contract";
import { type HostPeerContext, hostRouter } from "../devices/host";
import { type Host, wireHost } from "../devices/host/wire";
import { wireRegistry } from "../devices/registry";
import { NotPairedError } from "./from-host";
import type { HostLink } from "./host-links";
import { httpsLink, type LinkState } from "./link";

/**
 * A link ends only on its own Host's refusal (ADR 45). Real Hosts over
 * HTTP: their keys, their admission, their router, and the link's client.
 */

type RealHost = {
	host: Host;
	url: string;
	/** A Device's key here, with access. */
	pair(deviceId: string): Promise<{ key: string; personId: string }>;
	stop(): void;
};

async function realHost(id: string): Promise<RealHost> {
	const people: AuthSandbox = await createAuthSandbox();
	const dataDir = mkdtempSync(join(tmpdir(), "nightshift-refusal-"));
	const log = createRunLog(people.db, { walkerId: id, dataDir });
	const host = wireHost({
		auth: people.auth,
		db: people.db,
		registry: wireRegistry({ db: people.db }).paired({
			deviceRows: deviceRowsOn(people.db),
			logFact: async (fact, writes) => {
				await log.append(fact, writes);
			},
			history: createRunHistory({
				db: people.db,
				dataDir,
				log,
				bus: createRunBus(),
			}),
		}),
		settings: {
			current: () => ({ host: true, hostAddresses: [], deviceKeyIdleDays: 30 }),
		} as unknown as SettingsStore,
		self: { id, name: id },
		devicesPage: "https://studio.invalid/devices",
		fingerprint: null,
		disconnect: () => {},
		forgetClones: async () => {},
	});
	const handler = new RPCHandler(hostRouter);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const { response } = await handler.handle(request, {
				prefix: "/rpc",
				context: {
					deviceKey: await host.keyOf(request.headers),
					deviceVersion: deviceVersionOf(request.headers),
					askedHost: askedHostOf(request.headers),
					devices: host,
				} as unknown as HostPeerContext,
			});
			return response ?? new Response(null, { status: 404 });
		},
	});
	const { userId: personId } = await people.signUp(`Ada-${id}`);
	const keys = wireDeviceKeys({ auth: people.auth, db: people.db });
	return {
		host,
		url: `http://127.0.0.1:${server.port}`,
		async pair(deviceId) {
			await host.registry.join({
				id: deviceId,
				name: deviceId,
				platform: "test",
				ownerId: personId,
				homeHost: null,
			});
			const { key } = await keys.issue({
				personId,
				deviceId,
				deviceName: deviceId,
			});
			return { key, personId };
		},
		stop() {
			server.stop(true);
			people.cleanup();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

let a: RealHost;
let c: RealHost;
beforeEach(async () => {
	a = await realHost("host-a");
	c = await realHost("host-c");
});
afterEach(() => {
	a.stop();
	c.stop();
});

/** A link with Host A at these addresses, and what it said. */
function linked(addresses: string[], key: string) {
	const seen = { revoked: 0, states: [] as LinkState["status"][] };
	const record: HostLink = {
		hostId: "host-a",
		name: "A",
		addresses,
		certificate: null,
		fingerprint: null,
		role: "guest",
		personId: "ada",
		keyStore: "file",
		createdAt: 0,
		revokedAt: null,
	};
	const link = httpsLink({
		link: record,
		key,
		heartbeatMs: 10,
		firstBackoffMs: 5,
		maxBackoffMs: 10,
		onRevoked: () => seen.revoked++,
		onState: (state) => seen.states.push(state.status),
	});
	return { link, seen };
}

async function until(check: () => boolean) {
	const deadline = now() + 10_000;
	while (!check()) {
		if (now() > deadline) throw new Error("Timed out.");
		await Bun.sleep(5);
	}
}

/** The bytes a Host answers to a hello with these headers. */
async function answered(at: RealHost, headers: Record<string, string>) {
	const response = await fetch(`${at.url}/rpc/link/hello`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: "{}",
	});
	return { status: response.status, body: await response.text() };
}

/** What every caller gets whom the Host does not name itself to. */
const UNNAMED = {
	status: 401,
	body: '{"json":{"defined":true,"code":"UNAUTHORIZED","status":401,"message":"This device has no access here. Pair it again."}}',
};

describe("a link", () => {
	test("ends when its own Host removed the Device, on a heartbeat and on a new hello", async () => {
		const { key, personId } = await a.pair("device-b");
		const { link, seen } = linked([a.url], key);
		await until(() => link.state().status === "online");
		await a.host.revoke(personId, "device-b");
		await until(() => link.state().status === "revoked");
		expect(seen.revoked).toBe(1);
		await link.close();

		const again = linked([a.url], key);
		await until(() => again.seen.states.length > 0);
		expect(again.seen).toEqual({ revoked: 1, states: ["revoked"] });
		await again.link.close();
	});

	test("does not end at another Host that refuses the key: it tries the next address", async () => {
		const { key } = await a.pair("device-b");
		const { link, seen } = linked([c.url, a.url], key);
		await until(() => link.state().status === "online");
		expect(link.state().address).toBe(a.url);
		expect(seen).toEqual({ revoked: 0, states: ["online"] });
		await link.close();

		const alone = linked([c.url], key);
		await until(() => alone.seen.states.length > 0);
		await Bun.sleep(50);
		expect(alone.seen).toEqual({ revoked: 0, states: ["offline"] });
		await alone.link.close();
	});

	for (const [what, code, data] of [
		["names no Host", "UNAUTHORIZED", undefined],
		["names another Host", "UNAUTHORIZED", { hostId: "host-c" }],
		["names another Host, as FORBIDDEN", "FORBIDDEN", { hostId: "host-c" }],
		["names its Host in another shape", "UNAUTHORIZED", { host: "host-a" }],
		["is no refusal of the key", "CONFLICT", { hostId: "host-a" }],
	] as const) {
		test(`does not end on a refusal that ${what}`, async () => {
			const status =
				code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : 409;
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: () =>
					Response.json(
						{ json: { defined: true, code, status, message: "No.", data } },
						{ status },
					),
			});
			const { link, seen } = linked(
				[`http://127.0.0.1:${server.port}`],
				"nsd_k",
			);
			await until(() => seen.states.length > 0);
			await Bun.sleep(50);
			expect(seen).toEqual({ revoked: 0, states: ["offline"] });
			await link.close();
			server.stop(true);
		});
	}

	test("a call says which Host refused: its own one, and no other", async () => {
		const { key, personId } = await a.pair("device-b");
		const { link } = linked([a.url], key);
		const client = await link.ready();
		await a.host.revoke(personId, "device-b");
		const refused = await client.link.leave().catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(NotPairedError);
		expect(refused).toMatchObject({ hostId: "host-a" });
		await link.close();
	});
});

describe("a Host that refuses a key", () => {
	test("names itself to a call that means it", async () => {
		const answer = await answered(a, { [HOST_HEADER]: "host-a" });
		expect(answer.status).toBe(401);
		expect(JSON.parse(answer.body).json).toMatchObject({
			defined: true,
			code: "UNAUTHORIZED",
			data: { hostId: "host-a" },
		});
	});

	test("names itself at a stream, and in a FORBIDDEN of the key", async () => {
		const { key } = await a.pair("device-b");
		const stream = await fetch(`${a.url}/rpc/sync/commands`, {
			method: "POST",
			headers: { "content-type": "application/json", [HOST_HEADER]: "host-a" },
			body: "{}",
		});
		expect(await stream.json()).toMatchObject({
			json: { data: { hostId: "host-a" } },
		});
		const access = await a.host.keyOf(
			new Headers({ authorization: `Bearer ${key}` }),
		);
		expect(access).not.toBeNull();
		const without = (askedHost: string | null) =>
			a.host.admit(access, undefined, 1, askedHost).catch((e) => e);
		expect(await without("host-a")).toMatchObject({
			code: "FORBIDDEN",
			data: { hostId: "host-a" },
		});
		expect(await without(null)).toMatchObject({ data: undefined });
	});

	test("names itself to no one else: the same bytes for no header, another id, and an unknown key", async () => {
		const unknown = { authorization: "Bearer nsd_unknown" };
		for (const headers of [
			{},
			unknown,
			...["", "host-c", "HOST-A", "host-a ,x", "host", "host-ab", "*"].flatMap(
				(id) => [{ [HOST_HEADER]: id }, { ...unknown, [HOST_HEADER]: id }],
			),
		]) {
			expect(await answered(a, headers), JSON.stringify(headers)).toEqual(
				UNNAMED,
			);
		}
	});
});
