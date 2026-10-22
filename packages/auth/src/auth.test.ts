import { afterAll, beforeAll, expect, test } from "bun:test";

import { type AuthSandbox, createAuthSandbox } from "./testing";

let sandbox: AuthSandbox;
beforeAll(async () => {
	sandbox = await createAuthSandbox();
});
afterAll(() => sandbox.cleanup());

test("the Host does not redirect to another site for the phone app's sign-in", async () => {
	// The expo plugin's OAuth helper: Night Shift has no OAuth sign-in, so
	// it would only send a link on the Host's domain to any other site.
	const url = new URL(
		"http://localhost:3000/api/auth/expo-authorization-proxy",
	);
	url.searchParams.set("authorizationURL", "https://nightshift-login.evil/");
	url.searchParams.set("oauthState", "x");

	const response = await sandbox.auth.handler(new Request(url.toString()));

	expect(response.status).toBe(404);
	expect(response.headers.get("location")).toBeNull();
});
