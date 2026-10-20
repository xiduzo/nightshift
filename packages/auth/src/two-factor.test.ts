import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { CLIENT_IP_HEADERS } from "./index";
import {
	type AuthSandbox,
	cookiesOf,
	createAuthSandbox,
} from "./testing/sandbox";
import { codeFor, codeNow, turnOnTwoFactor } from "./testing/two-factor";

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

const PASSWORD = "a-long-password";

/** Email and password: the answer, and the cookies it sets. */
async function signInStart(email: string) {
	const response = await sandbox.auth.api.signInEmail({
		body: { email, password: PASSWORD },
		asResponse: true,
	});
	return {
		status: response.status,
		body: (await response.json()) as { twoFactorRedirect?: boolean },
		cookies: cookiesOf(response),
	};
}

async function sessionOf(headers: Headers) {
	return sandbox.auth.api.getSession({ headers });
}

describe("two-factor sign-in", () => {
	test("with two-factor on, the password alone gives no session: the code from the app does", async () => {
		const ada = await sandbox.signUp("Ada");
		const { secret, headers } = await turnOnTwoFactor(
			sandbox.auth,
			ada.headers,
		);
		expect((await sessionOf(headers))?.user.twoFactorEnabled).toBe(true);

		const start = await signInStart("ada@example.com");
		expect(start.status).toBe(200);
		expect(start.body.twoFactorRedirect).toBe(true);
		expect(await sessionOf(start.cookies)).toBeNull();

		const now = await codeFor(sandbox.auth, secret);
		const wrong = await sandbox.auth.api.verifyTOTP({
			headers: start.cookies,
			body: { code: now === "000000" ? "111111" : "000000" },
			asResponse: true,
		});
		expect(wrong.status).toBe(401);

		const right = await sandbox.auth.api.verifyTOTP({
			headers: start.cookies,
			body: { code: await codeFor(sandbox.auth, secret) },
			asResponse: true,
		});
		expect(right.ok).toBe(true);
		const session = await sessionOf(cookiesOf(right));
		expect(session?.user.id).toBe(ada.userId);
	});

	test("the test's own authenticator agrees with the plugin", async () => {
		expect(codeNow("a-secret")).toBe(await codeFor(sandbox.auth, "a-secret"));
	});

	test("a backup code signs in once", async () => {
		const ada = await sandbox.signUp("Ada");
		const { backupCodes } = await turnOnTwoFactor(sandbox.auth, ada.headers);
		expect(backupCodes).toHaveLength(10);
		const [code, other] = backupCodes as [string, string];

		const first = await signInStart("ada@example.com");
		const used = await sandbox.auth.api.verifyBackupCode({
			headers: first.cookies,
			body: { code },
			asResponse: true,
		});
		expect(used.ok).toBe(true);
		expect((await sessionOf(cookiesOf(used)))?.user.id).toBe(ada.userId);

		const second = await signInStart("ada@example.com");
		const again = await sandbox.auth.api.verifyBackupCode({
			headers: second.cookies,
			body: { code },
			asResponse: true,
		});
		expect(again.status).toBe(401);
		const fresh = await sandbox.auth.api.verifyBackupCode({
			headers: second.cookies,
			body: { code: other },
			asResponse: true,
		});
		expect(fresh.ok).toBe(true);
	});

	test("without two-factor, the password signs in as before", async () => {
		await sandbox.signUp("Ada");
		const start = await signInStart("ada@example.com");
		expect(start.body.twoFactorRedirect).toBeUndefined();
		expect(await sessionOf(start.cookies)).not.toBeNull();
	});

	test("turning it on needs the password", async () => {
		const ada = await sandbox.signUp("Ada");
		await expect(
			sandbox.auth.api.enableTwoFactor({
				headers: ada.headers,
				body: { password: "not-the-password" },
			}),
		).rejects.toThrow();
	});

	test("the setup link names Night Shift", async () => {
		const ada = await sandbox.signUp("Ada");
		const enabled = await sandbox.auth.api.enableTwoFactor({
			headers: ada.headers,
			body: { password: PASSWORD },
		});
		const uri = new URL((enabled as { totpURI: string }).totpURI);
		expect(uri.searchParams.get("issuer")).toBe("Night Shift");
	});
});

describe("rate limits, whatever NODE_ENV says", () => {
	/** A sign-in through Better Auth's handler, from that client address. */
	function signInFrom(
		headers: Record<string, string>,
		password = "wrong-password",
	) {
		return sandbox.auth.handler(
			new Request("http://localhost:3000/api/auth/sign-in/email", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:3001",
					...headers,
				},
				body: JSON.stringify({ email: "ada@example.com", password }),
			}),
		);
	}

	test("five sign-ins a minute per client, read from cf-connecting-ip first", async () => {
		await sandbox.signUp("Ada");
		const client = { "cf-connecting-ip": "203.0.113.7" };
		for (let i = 0; i < 5; i++) {
			expect((await signInFrom(client)).status).toBe(401);
		}
		expect((await signInFrom(client)).status).toBe(429);
		// Another client is not limited by the first.
		expect(
			(await signInFrom({ "cf-connecting-ip": "203.0.113.8" })).status,
		).toBe(401);
		// cf-connecting-ip comes before x-forwarded-for.
		expect(
			(
				await signInFrom({
					"cf-connecting-ip": "203.0.113.7",
					"x-forwarded-for": "198.51.100.1",
				})
			).status,
		).toBe(429);
	});

	test("x-forwarded-for, then the connection's own address", async () => {
		await sandbox.signUp("Ada");
		const proxied = { "x-forwarded-for": "198.51.100.20" };
		for (let i = 0; i < 5; i++) await signInFrom(proxied);
		expect((await signInFrom(proxied)).status).toBe(429);
		const direct = { [CLIENT_IP_HEADERS[2] as string]: "192.0.2.30" };
		for (let i = 0; i < 5; i++) await signInFrom(direct);
		expect((await signInFrom(direct)).status).toBe(429);
	});
});
