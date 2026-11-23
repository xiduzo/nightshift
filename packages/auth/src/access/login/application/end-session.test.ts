import { describe, expect, test } from "bun:test";
import { inMemoryLoginPorts } from "../adapters/out/in-memory-neighbours";
import { endSession } from "./end-session";

/** The use case endSession, on in-memory adapters. The twin of `login.test.ts`. */

describe("endSession", () => {
	test("signs that screen out, and only the Person's own", async () => {
		const ports = inMemoryLoginPorts();
		ports.sessionStore.add({ id: "phone", personId: "ada", expiresAt: 10 });
		const end = endSession(ports);
		expect(await end({ personId: "bob", sessionId: "phone" })).toBe(false);
		expect(ports.sessionStore.records.has("phone")).toBe(true);
		expect(await end({ personId: "ada", sessionId: "phone" })).toBe(true);
		expect(ports.sessionStore.records.has("phone")).toBe(false);
	});
});
