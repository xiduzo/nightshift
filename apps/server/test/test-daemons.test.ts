import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "./test-daemons";

/**
 * `startDaemon` returns only a daemon that answers. A daemon that cannot
 * start fails the start, and the error says why, with what it wrote.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-test-daemons-"));

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("startDaemon", () => {
	test("given a port that another process has, when the daemon cannot listen, then the start fails at once with its output", async () => {
		// The other process answers too: the start must not take it for the daemon.
		const other = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => new Response("OK"),
		});
		try {
			const started = startDaemon(root, "busy", {}, other.port as number);

			const error = await started.then(
				() => null,
				(reason: unknown) => reason,
			);

			expect(error).toBeInstanceOf(Error);
			const message = (error as Error).message;
			expect(message).toContain(
				`Daemon "busy" (http://localhost:${other.port})`,
			);
			expect(message).toContain("another process has the port");
			expect(message).toContain("Its last output:");
			expect(message).toContain("EADDRINUSE");
		} finally {
			other.stop(true);
		}
	}, 45_000);

	test("given a setting the daemon refuses, when it stops before it listens, then the start fails with its code and its output", async () => {
		const error = await startDaemon(root, "refused", {
			BETTER_AUTH_SECRET: "too short",
		}).then(
			() => null,
			(reason: unknown) => reason,
		);

		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toMatch(
			/it stopped \(code [1-9]\d*\) before it listened\./,
		);
		expect(message).toContain("BETTER_AUTH_SECRET");
	}, 45_000);
});
