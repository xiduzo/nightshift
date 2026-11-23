import { describe, expect, test } from "bun:test";
import { inMemoryLocalSessionPorts } from "../adapters/out/in-memory-neighbours";
import { pickHeaders } from "./pick-headers";

/** The use case pickHeaders, on in-memory adapters. */

describe("pickHeaders", () => {
	test("keeps the headers of a request with a live session of its own", async () => {
		const ports = inMemoryLocalSessionPorts();
		ports.sessions.add("bob", { token: "bobs", expiresAt: 10 });
		const headers = ports.sessions.cookie("bobs");
		expect(await pickHeaders(ports)({ personId: "ada", headers })).toBe(
			headers,
		);
	});

	test("gives a request without a cookie the local cookie, and reads no session", async () => {
		const ports = inMemoryLocalSessionPorts();
		const headers = await pickHeaders(ports)({
			personId: "ada",
			headers: new Headers(),
		});
		expect(await ports.sessions.read(headers)).toMatchObject({
			user: { id: "ada" },
		});
		expect(ports.sessions.calls.slice(0, 4)).toEqual([
			"hasCookie",
			"latest",
			"create",
			"withCookie",
		]);
	});

	test("gives a request whose own session ended the local cookie", async () => {
		const ports = inMemoryLocalSessionPorts();
		const headers = await pickHeaders(ports)({
			personId: "ada",
			headers: ports.sessions.cookie("ended"),
		});
		expect(headers.get("cookie")).not.toContain("ended");
	});
});
