import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonEnv, SERVER_DIR } from "./test-daemons";

/**
 * The dev entry (`bun src/main.ts`) with a listen address it cannot use.
 * It must not run on: it gives its database lease up, says why with the
 * address, and exits with code 1.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-listen-"));

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** The longest the daemon may take to give up, as in `port-taken.test.ts`. */
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

async function startWith(name: string, env: Record<string, string>) {
	const child = Bun.spawn(["bun", "src/main.ts"], {
		cwd: SERVER_DIR,
		// A port nothing listens on: the address, not the port, is wrong.
		env: daemonEnv(root, name, 9, env),
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
		const said = await Promise.race([output, Bun.sleep(2_000).then(() => "")]);
		return { code, said };
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
	}
}

describe("the dev entry with a listen address it cannot use", () => {
	test("given NIGHTSHIFT_LISTEN is not an address, when the daemon starts, then it gives the lease up and exits with code 1 and says why", async () => {
		const { code, said } = await startWith("typo", {
			NIGHTSHIFT_LISTEN: "127.0.0.1:3000",
		});

		expect({ code, said }).toMatchObject({ code: 1 });
		expect(said).toContain(
			"127.0.0.1:3000 is not an address to listen on. Use an IP address or a host name, for example 127.0.0.1.",
		);
		expect(said).not.toContain("UNCAUGHT EXCEPTION");
		expect(said).not.toContain("Night Shift answers at");
		expect(leaseOwner(join(root, "typo"))).toBeNull();
	}, 45_000);

	test("given a Host listens on an address that is not this computer's, when the daemon starts, then it names the address, not the port", async () => {
		const { code, said } = await startWith("elsewhere", {
			NIGHTSHIFT_HOST: "on",
			NIGHTSHIFT_HOST_ADDRESSES: "https://nightshift.example.com",
			// A Host starts Ollama by itself. Its stop can outlast the bound of a
			// stop, and the lease would stay: not what this test is about.
			NIGHTSHIFT_OLLAMA: "off",
			// TEST-NET-1 (RFC 5737): never an address of this computer.
			NIGHTSHIFT_LISTEN: "192.0.2.1",
		});

		expect({ code, said }).toMatchObject({ code: 1 });
		expect(said).toContain(
			"Night Shift cannot listen on 192.0.2.1: this computer has no such address. Use an address of this computer, for example 127.0.0.1.",
		);
		expect(said).not.toContain("another program uses it");
		expect(leaseOwner(join(root, "elsewhere"))).toBeNull();
	}, 45_000);
});
