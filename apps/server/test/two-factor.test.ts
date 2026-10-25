import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppRouterClient } from "@nightshift/api";
import { TWO_FACTOR_REQUIRED } from "@nightshift/auth";
import { codeNow, secretOf } from "@nightshift/auth/testing";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { type Daemon, startDaemon, stopDaemon } from "./test-daemons";

/**
 * A Host started with NIGHTSHIFT_REQUIRE_TWO_FACTOR=on, end to end: a
 * person who signs in from another computer (through a tunnel: it adds
 * its header) can only set two-factor up until it is on. This computer's
 * own Person is never asked.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-two-factor-"));
let host: Daemon;

const EMAIL = "colleague@example.com";
const PASSWORD = "a-long-password";
/** Through Cloudflare Tunnel on the Host: another computer. */
const ELSEWHERE = { "cf-connecting-ip": "203.0.113.20" };

/** A browser on another computer: its cookies, kept between calls. */
function browser() {
	let cookie = "";
	async function auth(path: string, body?: unknown) {
		const response = await fetch(`${host.url}/api/auth${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:3001",
				cookie,
				...ELSEWHERE,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const set = response.headers.getSetCookie();
		if (set.length > 0) {
			const jar = new Map(
				cookie
					.split("; ")
					.filter(Boolean)
					.map((c) => c.split("=") as [string, string]),
			);
			for (const c of set) {
				const [pair] = c.split(";");
				const [name, ...value] = (pair ?? "").split("=");
				if (!name) continue;
				if (/max-age=0/i.test(c)) jar.delete(name);
				else jar.set(name, value.join("="));
			}
			cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
		}
		return response;
	}
	const client = (): AppRouterClient =>
		createORPCClient(
			new RPCLink({
				url: `${host.url}/rpc`,
				headers: () => ({ cookie, ...ELSEWHERE }),
			}),
		);
	return { auth, client };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		return (error as { code?: string }).code ?? String(error);
	}
	throw new Error("The call did not fail.");
}

let invitationId: string;

beforeAll(async () => {
	host = await startDaemon(root, "host", {
		NIGHTSHIFT_HOST: "on",
		NIGHTSHIFT_REQUIRE_TWO_FACTOR: "on",
	});
	await host.client.spaces.create({ name: "Platform" });
	invitationId = (
		await host.client.members.invite({ email: EMAIL, role: "member" })
	).id;
}, 90_000);

afterAll(async () => {
	await stopDaemon(host);
	rmSync(root, { recursive: true, force: true });
});

describe("a Host that requires two-factor sign-in", () => {
	test("this computer's Person is not asked", async () => {
		expect(await host.client.runs.list({})).toEqual([]);
		expect(await host.client.account.status()).toMatchObject({
			thisComputer: true,
			twoFactor: { required: false, setUpNeeded: false },
		});
	});

	test("a person from another computer sets two-factor up first, then signs in with a code", async () => {
		const b = browser();
		const signedUp = await b.auth("/sign-up/email", {
			name: "Colleague",
			email: EMAIL,
			password: PASSWORD,
			invitationId,
		});
		expect(signedUp.ok).toBe(true);

		// Signed in, but only the setup is open.
		expect(await b.client().account.status()).toMatchObject({
			signedIn: true,
			thisComputer: false,
			hasPassword: true,
			twoFactor: { enabled: false, required: true, setUpNeeded: true },
		});
		expect(await codeOf(b.client().runs.list({}))).toBe(TWO_FACTOR_REQUIRED);
		expect(await codeOf(b.client().invitations.accept({ invitationId }))).toBe(
			TWO_FACTOR_REQUIRED,
		);
		const organizations = await b.auth("/organization/list");
		expect(organizations.status).toBe(403);
		expect(await organizations.json()).toMatchObject({
			code: TWO_FACTOR_REQUIRED,
		});
		expect((await b.auth("/get-session")).ok).toBe(true);

		// Turn it on: the password, then the first code from the app.
		const enabled = await b.auth("/two-factor/enable", { password: PASSWORD });
		expect(enabled.ok).toBe(true);
		const { totpURI } = (await enabled.json()) as { totpURI: string };
		const secret = secretOf(totpURI);
		const verified = await b.auth("/two-factor/verify-totp", {
			code: codeNow(secret),
		});
		expect(verified.ok).toBe(true);
		expect(await b.client().invitations.accept({ invitationId })).toMatchObject(
			{ spaceId: expect.any(String) },
		);
		expect(await b.client().account.status()).toMatchObject({
			twoFactor: { enabled: true, setUpNeeded: false },
		});

		// A new sign-in needs the code.
		const later = browser();
		const password = await later.auth("/sign-in/email", {
			email: EMAIL,
			password: PASSWORD,
		});
		expect(await password.json()).toMatchObject({ twoFactorRedirect: true });
		expect(await codeOf(later.client().runs.list({}))).toBe("UNAUTHORIZED");
		const code = await later.auth("/two-factor/verify-totp", {
			code: codeNow(secret),
			trustDevice: true,
		});
		expect(code.ok).toBe(true);
		expect(Array.isArray(await later.client().runs.list({}))).toBe(true);
	});
});
