import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";

import {
	authOriginsOf,
	hostAuthOrigins,
	phoneOrigins,
	trustedOriginsOf,
} from "./origins";

const env = {
	CORS_ORIGIN: "http://localhost:3001",
	BETTER_AUTH_URL: "http://localhost:3000",
};

describe("the origins Better Auth trusts", () => {
	test("hold the desktop app and this daemon's own pages", () => {
		expect(authOriginsOf(3000)).not.toContain("exp://");
		expect(authOriginsOf(3000)).toContain("views://mainview");
		expect(authOriginsOf(3000)).toContain("http://localhost:3000");
	});

	test("hold the phone app's scheme only on a Host", () => {
		expect(authOriginsOf(3000)).not.toContain("nightshift://");
		expect(hostAuthOrigins({ host: false, hostAddresses: [] })).toEqual([]);
		expect(
			hostAuthOrigins({
				host: true,
				hostAddresses: ["https://ns.example:8443/path", "not an address"],
			}),
		).toEqual(["https://ns.example:8443", "nightshift://"]);
	});

	test("keep the Host's addresses while it is no Host", () => {
		expect(
			hostAuthOrigins({ host: false, hostAddresses: ["https://ns.example"] }),
		).toEqual(["https://ns.example"]);
	});

	test("the phone app never gets the local session", () => {
		const local = trustedOriginsOf(env, 3000);
		for (const origin of phoneOrigins) expect(local.has(origin)).toBe(false);
	});
});

/**
 * The origins Better Auth trusts for a request: its own list, with what
 * its plugins add when it starts.
 */
async function requestOrigins(sandbox: AuthSandbox): Promise<unknown[]> {
	// After it starts, the list is a function (plugins add to it).
	const trustedOrigins = (await sandbox.auth.$context).options
		.trustedOrigins as unknown as
		| readonly unknown[]
		| (() => Promise<readonly unknown[]> | readonly unknown[]);
	return typeof trustedOrigins === "function"
		? [...(await trustedOrigins())]
		: [...trustedOrigins];
}

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

	test("does not come from Expo Go outside development", async () => {
		const origin = await originOf({
			"expo-origin": "exp://attacker.example/--/",
		});
		expect(origin).toBe("exp://attacker.example/--/");
		expect(await trusted(origin)).toBe(false);
		expect(await requestOrigins(sandbox)).not.toContain("exp://");
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

describe("a sign-in from Expo Go", () => {
	let sandbox: AuthSandbox;
	const nodeEnv = process.env.NODE_ENV;
	beforeAll(async () => {
		// The expo plugin reads NODE_ENV when Better Auth starts.
		process.env.NODE_ENV = "development";
		sandbox = await createAuthSandbox({ trustedOrigins: () => phoneOrigins });
		await sandbox.auth.$context;
	});
	afterAll(() => {
		process.env.NODE_ENV = nodeEnv;
		sandbox.cleanup();
	});

	test("is trusted while you build the app", async () => {
		expect(await requestOrigins(sandbox)).toContain("exp://");
	});
});
