import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { claimHostAdmin } from "./claim-host-admin";

describe("claimHostAdmin", () => {
	test("the first Person becomes the Host admin", async () => {
		const ports = inMemoryMembersPorts();
		await ports.seed.person({
			id: "ada",
			name: "Ada",
			email: "a@x.org",
			role: "user",
		});
		await claimHostAdmin(ports)({ personId: "ada" });
		expect(await ports.personStore.roleOf("ada")).toBe("admin");
	});

	test("a Host with an admin keeps it", async () => {
		const ports = inMemoryMembersPorts();
		await ports.seed.person({
			id: "ada",
			name: "Ada",
			email: "a@x.org",
			role: "admin",
		});
		await ports.seed.person({
			id: "bo",
			name: "Bo",
			email: "b@x.org",
			role: "user",
		});
		await claimHostAdmin(ports)({ personId: "bo" });
		expect(await ports.personStore.roleOf("bo")).toBe("user");
	});
});
