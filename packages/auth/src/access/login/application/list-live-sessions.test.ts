import { describe, expect, test } from "bun:test";
import { loginPorts } from "../test-support";
import { listLiveSessions } from "./list-live-sessions";

/** The use case listLiveSessions, over a database in memory. */

describe("listLiveSessions", () => {
	test("keeps the sessions that exist and have not expired", async () => {
		const ports = await loginPorts();
		await ports.addSession({ id: "phone", personId: "ada", expiresAt: 20 });
		await ports.addSession({ id: "old", personId: "ada", expiresAt: 5 });
		expect(
			await listLiveSessions(ports)({
				sessionIds: ["phone", "old", "gone"],
				at: 10,
			}),
		).toEqual(new Set(["phone"]));
	});

	test("asks nothing for no session", async () => {
		const { sessionStore } = await loginPorts();
		let reads = 0;
		const list = listLiveSessions({
			sessionStore: {
				live: async (...asked) => {
					reads += 1;
					return sessionStore.live(...asked);
				},
			},
		});
		expect(await list({ sessionIds: [], at: 10 })).toEqual(new Set());
		expect(reads).toBe(0);
	});
});
