import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	authEndpointAllowed,
	type HostCaller,
	hostAccess,
	hostPolicyFromEnv,
	OPEN_HOST,
	TWO_FACTOR_REQUIRED,
} from "./host-access";
import { createLocalSession } from "./local-session";
import { requestAccess } from "./request";
import { localPerson } from "./spaces";
import { type AuthSandbox, createAuthSandbox } from "./testing/sandbox";
import { turnOnTwoFactor } from "./testing/two-factor";

const REQUIRED = { requireTwoFactor: true };

const remote = (twoFactorEnabled: boolean | null): HostCaller => ({
	session: { user: { twoFactorEnabled } },
	fromThisComputer: false,
});

describe("who may use the Host", () => {
	test("an open Host lets every session in", () => {
		expect(hostAccess(OPEN_HOST, remote(false))).toEqual({ allowed: true });
	});

	test("a Host that requires two-factor refuses a session from another computer without it", () => {
		for (const state of [false, null]) {
			const access = hostAccess(REQUIRED, remote(state));
			expect(access.allowed).toBe(false);
			if (!access.allowed) expect(access.code).toBe(TWO_FACTOR_REQUIRED);
		}
		expect(hostAccess(REQUIRED, remote(true))).toEqual({ allowed: true });
	});

	test("this computer and Device keys are never refused", () => {
		expect(
			hostAccess(REQUIRED, { ...remote(false), fromThisComputer: true }),
		).toEqual({ allowed: true });
		expect(
			hostAccess(REQUIRED, {
				session: null,
				fromThisComputer: false,
				device: true,
			}),
		).toEqual({ allowed: true });
	});

	test("no session: nothing to refuse here", () => {
		expect(
			hostAccess(REQUIRED, { session: null, fromThisComputer: false }),
		).toEqual({ allowed: true });
	});
});

describe("NIGHTSHIFT_REQUIRE_TWO_FACTOR", () => {
	test("on and off, in any case", () => {
		for (const on of ["on", " ON ", "true", "1", "yes"]) {
			expect(hostPolicyFromEnv({ NIGHTSHIFT_REQUIRE_TWO_FACTOR: on })).toEqual(
				REQUIRED,
			);
		}
		for (const off of [undefined, "", "off", "false", "0", "no"]) {
			expect(hostPolicyFromEnv({ NIGHTSHIFT_REQUIRE_TWO_FACTOR: off })).toEqual(
				OPEN_HOST,
			);
		}
	});

	test("a typo stops the Host instead of leaving it open", () => {
		expect(() =>
			hostPolicyFromEnv({ NIGHTSHIFT_REQUIRE_TWO_FACTOR: "onn" }),
		).toThrow('NIGHTSHIFT_REQUIRE_TWO_FACTOR is "onn". Use on or off.');
	});
});

describe("Better Auth's endpoints while two-factor waits to be set up", () => {
	const refused = hostAccess(REQUIRED, remote(false));

	test("setting it up, the session and signing out stay open", () => {
		for (const path of [
			"/get-session",
			"/list-accounts",
			"/sign-out",
			"/sign-in/email",
			"/two-factor/enable",
			"/two-factor/verify-totp",
			"/two-factor/generate-backup-codes",
			"/get-session?disableCookieCache=true",
		]) {
			expect(authEndpointAllowed(refused, path)).toBe(true);
		}
	});

	test("everything else is refused", () => {
		for (const path of [
			"/organization/create",
			"/organization/set-active",
			"/admin/list-users",
			"/api-key/create",
			"/device/approve",
			"/change-password",
			"/update-user",
			"/get-session-of-another",
		]) {
			expect(authEndpointAllowed(refused, path)).toBe(false);
		}
	});

	test("an allowed session calls any endpoint", () => {
		expect(authEndpointAllowed({ allowed: true }, "/organization/create")).toBe(
			true,
		);
	});
});

describe("requestAccess on a Host that requires two-factor", () => {
	let sandbox: AuthSandbox;
	beforeEach(async () => {
		sandbox = await createAuthSandbox();
	});
	afterEach(() => sandbox.cleanup());

	test("a session from another computer is refused until its Person turns two-factor on", async () => {
		const ada = await sandbox.signUp("Ada");
		const before = await requestAccess(
			sandbox.auth,
			sandbox.db,
			ada.headers,
			null,
			REQUIRED,
		);
		expect(before.session?.user.id).toBe(ada.userId);
		expect(before.hostAccess.allowed).toBe(false);

		const { headers } = await turnOnTwoFactor(sandbox.auth, ada.headers);
		const after = await requestAccess(
			sandbox.auth,
			sandbox.db,
			headers,
			null,
			REQUIRED,
		);
		expect(after.hostAccess.allowed).toBe(true);
	});

	test("the local session of this computer is not affected", async () => {
		const person = await localPerson(sandbox.db);
		const local = createLocalSession(sandbox.auth, sandbox.db, person.userId);
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			new Headers(),
			local,
			REQUIRED,
		);
		expect(access.session?.user.id).toBe(person.userId);
		expect(access.hostAccess.allowed).toBe(true);
	});

	test("without the requirement, nothing changes", async () => {
		const ada = await sandbox.signUp("Ada");
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			ada.headers,
			null,
		);
		expect(access.hostAccess.allowed).toBe(true);
	});
});
