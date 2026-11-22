import { describe, expect, test } from "bun:test";
import { inMemoryLocalSessionPorts } from "../adapters/out/in-memory-neighbours";
import { findToken } from "./find-token";

/** The use case findToken, on in-memory adapters. */

describe("findToken", () => {
	test("makes a session when the Person has none, then keeps its token in memory", async () => {
		const ports = inMemoryLocalSessionPorts();
		const find = findToken(ports);
		const first = await find({ personId: "ada" });
		expect(ports.sessions.calls).toEqual(["latest", "create"]);
		expect(await find({ personId: "ada" })).toBe(first);
		expect(ports.sessions.calls).toEqual(["latest", "create"]);
	});

	test("takes the session that expires last", async () => {
		const ports = inMemoryLocalSessionPorts();
		ports.sessions.add("ada", { token: "soon", expiresAt: 10 });
		ports.sessions.add("ada", { token: "late", expiresAt: 20 });
		ports.sessions.add("bob", { token: "bobs", expiresAt: 30 });
		expect(await findToken(ports)({ personId: "ada" })).toBe("late");
	});

	test("looks again once the token in memory expired", async () => {
		const ports = inMemoryLocalSessionPorts();
		ports.sessions.add("ada", { token: "soon", expiresAt: 10 });
		expect(await findToken(ports)({ personId: "ada" })).toBe("soon");
		ports.sessions.now = 10;
		expect(await findToken(ports)({ personId: "ada" })).not.toBe("soon");
		expect(ports.sessions.calls).toEqual(["latest", "latest", "create"]);
	});
});
