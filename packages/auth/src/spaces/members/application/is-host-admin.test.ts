import { describe, expect, test } from "bun:test";
import { membersPorts } from "../test-support";
import { isHostAdmin } from "./is-host-admin";

describe("isHostAdmin", () => {
	test("only the Person with the admin role is", async () => {
		const ports = await membersPorts();
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
		expect(await isHostAdmin(ports)({ personId: "ada" })).toBe(true);
		expect(await isHostAdmin(ports)({ personId: "bo" })).toBe(false);
		expect(await isHostAdmin(ports)({ personId: "nobody" })).toBe(false);
	});
});
