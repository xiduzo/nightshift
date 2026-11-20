import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { hasHostAdmin } from "./has-host-admin";

describe("hasHostAdmin", () => {
	test("a Host without Persons, or without an admin, has none", async () => {
		const ports = inMemoryMembersPorts();
		expect(await hasHostAdmin(ports)()).toBe(false);
		await ports.seed.person({
			id: "ada",
			name: "Ada",
			email: "a@x.org",
			role: "user",
		});
		expect(await hasHostAdmin(ports)()).toBe(false);
	});

	test("a Person with the admin role is the Host admin", async () => {
		const ports = inMemoryMembersPorts();
		await ports.seed.person({
			id: "ada",
			name: "Ada",
			email: "a@x.org",
			role: "admin",
		});
		expect(await hasHostAdmin(ports)()).toBe(true);
	});
});
