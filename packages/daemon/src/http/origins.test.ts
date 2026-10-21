import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";

import { authOriginsOf, phoneOrigins, trustedOriginsOf } from "./origins";

const env = {
	CORS_ORIGIN: "http://localhost:3001",
	BETTER_AUTH_URL: "http://localhost:3000",
};

describe("the origins Better Auth trusts", () => {
	test("hold the phone app's scheme and Expo Go", () => {
		expect(authOriginsOf(3000)).toContain("nightshift://");
		expect(authOriginsOf(3000)).toContain("exp://");
		expect(authOriginsOf(3000)).toContain("views://mainview");
		expect(authOriginsOf(3000)).toContain("http://localhost:3000");
	});

	test("the phone app never gets the local session", () => {
		const local = trustedOriginsOf(env, 3000);
		for (const origin of phoneOrigins) expect(local.has(origin)).toBe(false);
	});
});

/**
 * Better Auth skips its origin check under `bun test`, so these ask its
 * matcher and the expo plugin directly, as a sign-in request would.
 */
describe("a sign-in from the phone app", () => {
	let sandbox: AuthSandbox;
	beforeAll(async () => {
		sandbox = await createAuthSandbox({ trustedOrigins: () => phoneOrigins });
	});
	afterAll(() => sandbox.cleanup());

	/** The origin Better Auth checks for a request with these headers. */
	async function originOf(headers: Record<string, string>) {
		const context = await sandbox.auth.$context;
		const plugin = context.options.plugins?.find((p) => p.id === "expo");
		const request = new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in`, {
			method: "POST",
			headers,
		});
		// The plugin reads no field of the context that this one lacks.
		const changed = await plugin?.onRequest?.(
			request,
			context as unknown as Parameters<
				NonNullable<NonNullable<typeof plugin>["onRequest"]>
			>[1],
		);
		const checked = changed && "request" in changed ? changed.request : request;
		return checked.headers.get("origin") ?? "";
	}

	async function trusted(origin: string) {
		return (await sandbox.auth.$context).isTrustedOrigin(origin);
	}

	test("comes from the app's scheme, in the expo-origin header", async () => {
		const origin = await originOf({ "expo-origin": "nightshift://" });
		expect(origin).toBe("nightshift://");
		expect(await trusted(origin)).toBe(true);
	});

	test("may come from Expo Go while you build the app", async () => {
		const origin = await originOf({
			"expo-origin": "exp://192.168.1.20:8081/--/",
		});
		expect(await trusted(origin)).toBe(true);
	});

	test("cannot replace the origin of a page", async () => {
		const origin = await originOf({
			origin: "https://evil.example",
			"expo-origin": "nightshift://",
		});
		expect(origin).toBe("https://evil.example");
		expect(await trusted(origin)).toBe(false);
	});

	test("is refused from another app's scheme", async () => {
		expect(
			await trusted(await originOf({ "expo-origin": "otherapp://" })),
		).toBe(false);
	});
});
