import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonEnv, SERVER_DIR } from "./test-daemons";

/**
 * The dev entry (`bun src/main.ts`) on a port that another program has. It
 * must not run on without a listener: it gives its database lease up and
 * exits, and it says which port and what to do.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-port-taken-"));

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/**
 * The longest the daemon may take to give up. A start takes about 4 s on
 * a loaded computer, and a clean stop at most 2 s more.
 */
const EXIT_MS = 30_000;

/** Who holds the lease of the database in `dataDir`: null once released. */
function leaseOwner(dataDir: string): string | null {
	const db = new Database(join(dataDir, "nightshift.db"), { readonly: true });
	try {
		const row = db.query("select owner from daemon_lease where id = 1").get() as
			| { owner: string | null }
			| undefined;
		if (!row) throw new Error("The daemon never took the lease.");
		return row.owner;
	} finally {
		db.close();
	}
}

describe("the dev entry on a port that another program has", () => {
	test("given the port is taken, when the daemon starts, then it gives the lease up and exits with code 1 and says why", async () => {
		const other = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => new Response("OK"),
		});
		const port = other.port as number;
		const child = Bun.spawn(["bun", "src/main.ts"], {
			cwd: SERVER_DIR,
			env: daemonEnv(root, "busy", port),
			stdout: "pipe",
			stderr: "pipe",
		});
		// Both streams are read from the start: a full pipe stops the daemon.
		const output = Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]).then((parts) => parts.join("\n"));
		try {
			const code = await Promise.race([
				child.exited,
				Bun.sleep(EXIT_MS).then(() => "still running" as const),
			]);
			if (code === "still running") child.kill("SIGKILL");
			const said = await Promise.race([
				output,
				Bun.sleep(2_000).then(() => ""),
			]);

			expect({ code, said }).toMatchObject({ code: 1 });
			expect(said).toContain(
				`Night Shift cannot listen on port ${port}: another program uses it. Stop that program or start Night Shift with another port.`,
			);
			expect(said).not.toContain("UNCAUGHT EXCEPTION");
			expect(leaseOwner(join(root, "busy"))).toBeNull();
		} finally {
			if (child.exitCode === null) child.kill("SIGKILL");
			other.stop(true);
		}
	}, 45_000);
});
