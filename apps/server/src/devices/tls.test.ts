import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	certificateFingerprint,
	hostCertificate,
	pinnedFetch,
	pinnedWebSocket,
} from "./tls";

/**
 * Pinning a Host's self-signed certificate: the Device trusts exactly the
 * certificate it saw at pairing. Two self-signed certificates for the same
 * name, made with openssl, stand in for "the Host's" and "another one".
 */

const openssl = Bun.which("openssl");
const dir = mkdtempSync(join(tmpdir(), "nightshift-tls-"));

function selfSigned(name: string) {
	const key = join(dir, `${name}.key`);
	const cert = join(dir, `${name}.pem`);
	const made = Bun.spawnSync([
		openssl as string,
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		key,
		"-out",
		cert,
		"-days",
		"2",
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost,IP:127.0.0.1",
	]);
	if (made.exitCode !== 0) throw new Error(made.stderr.toString());
	return { cert: readFileSync(cert, "utf8"), key: readFileSync(key, "utf8") };
}

function serveWith(tls: { cert: string; key: string }) {
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		tls,
		fetch: (request, server) =>
			server.upgrade(request) ? undefined : new Response("studio"),
		websocket: {
			open: (ws) => {
				ws.send("hello");
			},
			message: () => {},
		},
	});
}

let host: ReturnType<typeof serveWith>;
let impostor: ReturnType<typeof serveWith>;
let pinned: { cert: string; key: string };

beforeAll(() => {
	if (!openssl) return;
	pinned = selfSigned("host");
	host = serveWith(pinned);
	impostor = serveWith(selfSigned("impostor"));
});
afterAll(() => {
	host?.stop(true);
	impostor?.stop(true);
	rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!openssl)("a pinned self-signed certificate", () => {
	test("the Device reads the certificate and its fingerprint, as the Host shows it", async () => {
		const seen = await hostCertificate(`https://127.0.0.1:${host.port}`);
		expect(seen?.trusted).toBe(false);
		expect(seen?.fingerprint).toBe(certificateFingerprint(pinned.cert));
		expect(seen?.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
		expect(await hostCertificate("http://localhost:3000")).toBeNull();
	});

	test("fetch trusts the pinned certificate, and no other", async () => {
		const send = pinnedFetch(pinned.cert);
		expect(await (await send(`https://127.0.0.1:${host.port}/`)).text()).toBe(
			"studio",
		);
		await expect(send(`https://127.0.0.1:${impostor.port}/`)).rejects.toThrow();
		// Without the pin, a self-signed certificate is refused.
		await expect(fetch(`https://127.0.0.1:${host.port}/`)).rejects.toThrow();
	});

	test("the relay's WebSocket trusts the pinned certificate, and no other", async () => {
		const Socket = pinnedWebSocket(pinned.cert);
		const open = (port: number) =>
			new Promise<string>((resolve) => {
				const ws = new Socket(`wss://127.0.0.1:${port}/sync`);
				ws.onmessage = (message) => {
					resolve(String(message.data));
					ws.close();
				};
				ws.onerror = () => resolve("refused");
			});
		expect(await open(host.port as number)).toBe("hello");
		expect(await open(impostor.port as number)).toBe("refused");
	});
});
