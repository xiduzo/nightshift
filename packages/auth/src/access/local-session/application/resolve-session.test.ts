import { describe, expect, test } from "bun:test";
import { inMemoryLocalSessionPorts } from "../adapters/out/in-memory-neighbours";
import { resolveSession } from "./resolve-session";

/** The use case resolveSession, on in-memory adapters. */

describe("resolveSession", () => {
	test("a request with a live session of its own keeps it", async () => {
		const ports = inMemoryLocalSessionPorts();
		ports.sessions.add("bob", { token: "bobs", expiresAt: 10 });
		const headers = ports.sessions.cookie("bobs");
		const resolved = await resolveSession(ports)({ personId: "ada", headers });
		expect(resolved.session?.user.id).toBe("bob");
		expect(resolved.headers).toBe(headers);
		expect(ports.sessions.calls).toEqual(["hasCookie", "read"]);
	});

	test("a request without a session gets the local Person's, and reads it once", async () => {
		const ports = inMemoryLocalSessionPorts();
		const resolved = await resolveSession(ports)({
			personId: "ada",
			headers: new Headers(),
		});
		expect(resolved.session?.user.id).toBe("ada");
		expect(resolved.headers.get("cookie")).toContain(
			resolved.session?.session.token ?? "none",
		);
		expect(ports.sessions.calls).toEqual([
			"hasCookie",
			"latest",
			"create",
			"withCookie",
			"read",
		]);
	});

	test("the local session gives way to a new one when it ends, once", async () => {
		const ports = inMemoryLocalSessionPorts();
		const resolve = resolveSession(ports);
		const first = await resolve({ personId: "ada", headers: new Headers() });
		// Signed out everywhere.
		ports.sessions.sessions.clear();
		const after = await resolve({ personId: "ada", headers: new Headers() });
		expect(after.session?.user.id).toBe("ada");
		expect(after.session?.session.token).not.toBe(first.session?.session.token);
	});
});
