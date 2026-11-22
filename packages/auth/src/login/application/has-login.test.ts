import { describe, expect, test } from "bun:test";
import { inMemoryLoginPorts } from "../adapters/out/in-memory-neighbours";
import { hasLogin } from "./has-login";

/** The use case hasLogin, on in-memory adapters. */

describe("hasLogin", () => {
	test("a Person has a login once they have a password", async () => {
		const ports = inMemoryLoginPorts();
		ports.credentials.add({ id: "ada", email: "ada@example.com" });
		expect(await hasLogin(ports)({ personId: "ada" })).toBe(false);
		await ports.credentials.savePassword("ada", "a-long-password");
		expect(await hasLogin(ports)({ personId: "ada" })).toBe(true);
	});
});
