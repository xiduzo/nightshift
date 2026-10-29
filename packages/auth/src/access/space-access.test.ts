import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { TWO_FACTOR_REQUIRED } from "../host-access";
import { type AuthSandbox, createAuthSandbox } from "../testing/sandbox";
import { requestAccess } from "./request";
import { spaceAccess } from "./space-access";

/** The first rungs of a request in a Space: one answer for every way in. */

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

describe("spaceAccess", () => {
	test("a request without a session is asked to sign in", async () => {
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			new Headers(),
			null,
		);
		expect(spaceAccess(access)).toEqual({
			allowed: false,
			code: "UNAUTHORIZED",
			status: 401,
			message: "Sign in to use Night Shift.",
		});
	});

	test("a session the Host does not let in gets the Host's refusal", async () => {
		const { headers } = await sandbox.signUp("Ada");
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			headers,
			null,
			{
				requireTwoFactor: true,
			},
		);
		expect(spaceAccess(access)).toMatchObject({
			allowed: false,
			code: TWO_FACTOR_REQUIRED,
			status: 403,
		});
	});

	test("a session in a Space works there", async () => {
		const { userId, headers } = await sandbox.signUp("Ada");
		const access = await requestAccess(sandbox.auth, sandbox.db, headers, null);
		const answer = spaceAccess(access);
		expect(answer.allowed && answer.session.user.id).toBe(userId);
		expect(answer.allowed && answer.spaceId).toBe(access.spaceId ?? "");
	});
});
