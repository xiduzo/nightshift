import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HostLinks } from "@nightshift/engine";

import { joinHost } from "./join";

/**
 * A Host behind a proxy with its own private authority (Caddy's
 * `tls internal`): its certificate is neither from an authority this
 * computer trusts nor signed by itself, so it cannot be pinned. Joining
 * says so, instead of failing with the TLS error's code.
 */

const openssl = Bun.which("openssl");
const dir = mkdtempSync(join(tmpdir(), "nightshift-join-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]) {
	const made = Bun.spawnSync([openssl as string, ...args], { cwd: dir });
	if (made.exitCode !== 0) throw new Error(made.stderr.toString());
}

/** A leaf for localhost, signed by a private authority that is not sent. */
function privateAuthority() {
	run([
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"2",
		"-keyout",
		"ca.key",
		"-out",
		"ca.pem",
		"-subj",
		"/CN=Private authority",
	]);
	run([
		"req",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		"leaf.key",
		"-out",
		"leaf.csr",
		"-subj",
		"/CN=localhost",
	]);
	Bun.write(join(dir, "san.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1");
	run([
		"x509",
		"-req",
		"-in",
		"leaf.csr",
		"-CA",
		"ca.pem",
		"-CAkey",
		"ca.key",
		"-CAcreateserial",
		"-days",
		"2",
		"-out",
		"leaf.pem",
		"-extfile",
		"san.ext",
	]);
	return {
		cert: readFileSync(join(dir, "leaf.pem"), "utf8"),
		key: readFileSync(join(dir, "leaf.key"), "utf8"),
	};
}

describe("joining a Host", () => {
	test.skipIf(!openssl)(
		"whose certificate cannot be checked says so",
		async () => {
			const tls = privateAuthority();
			const host = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				tls,
				fetch: () => new Response("never"),
			});
			try {
				const progress = joinHost(
					{
						self: { id: "device-b", name: "laptop", platform: "darwin" },
						links: {} as HostLinks,
						keys: {
							kind: "file",
							get: async () => null,
							set: async () => {},
							delete: async () => {},
						},
						started: () => {},
					},
					{ url: `https://localhost:${host.port}`, role: "guest" },
				);
				await expect(progress.next()).rejects.toThrow(
					"This computer cannot check the certificate of the Host.",
				);
			} finally {
				host.stop(true);
			}
		},
	);
});
