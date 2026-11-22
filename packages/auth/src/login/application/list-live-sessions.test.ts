import { describe, expect, test } from "bun:test";
import { inMemoryLoginPorts } from "../adapters/out/in-memory-neighbours";
import { listLiveSessions } from "./list-live-sessions";

/** The use case listLiveSessions, on in-memory adapters. */

describe("listLiveSessions", () => {
	test("keeps the sessions that exist and have not expired", async () => {
		const ports = inMemoryLoginPorts();
		ports.sessionStore.add({ id: "phone", personId: "ada", expiresAt: 20 });
		ports.sessionStore.add({ id: "old", personId: "ada", expiresAt: 5 });
		expect(
			await listLiveSessions(ports)({
				sessionIds: ["phone", "old", "gone"],
				at: 10,
			}),
		).toEqual(new Set(["phone"]));
	});

	test("asks nothing for no session", async () => {
		const ports = inMemoryLoginPorts();
		expect(await listLiveSessions(ports)({ sessionIds: [], at: 10 })).toEqual(
			new Set(),
		);
		expect(ports.sessionStore.reads).toBe(0);
	});
});
