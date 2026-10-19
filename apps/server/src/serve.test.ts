import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type DaemonServe, listeners, serveDaemon, tlsPortOf } from "./serve";

/** A self-signed certificate for localhost, made with openssl. */
function selfSigned() {
	const dir = mkdtempSync(join(tmpdir(), "nightshift-serve-"));
	const made = Bun.spawnSync([
		Bun.which("openssl") as string,
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		join(dir, "key.pem"),
		"-out",
		join(dir, "cert.pem"),
		"-days",
		"2",
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost,IP:127.0.0.1",
	]);
	if (made.exitCode !== 0) throw new Error(made.stderr.toString());
	return {
		cert: readFileSync(join(dir, "cert.pem"), "utf8"),
		key: readFileSync(join(dir, "key.pem"), "utf8"),
	};
}

describe("where the daemon listens", () => {
	test("plain http at the hostname of its reach, without a certificate", () => {
		expect(listeners({ hostname: "0.0.0.0", tls: false, port: 3000 })).toEqual([
			{ hostname: "0.0.0.0", port: 3000, tls: false },
		]);
	});

	test("with its own certificate: http for this computer, https for the others", () => {
		expect(listeners({ hostname: "0.0.0.0", tls: true, port: 3000 })).toEqual([
			{ hostname: "127.0.0.1", port: 3000, tls: false },
			{ hostname: "0.0.0.0", port: 3443, tls: true },
		]);
		expect(
			listeners({
				hostname: "0.0.0.0",
				tls: true,
				port: 3000,
				tlsPort: 8443,
			})[1],
		).toEqual({ hostname: "0.0.0.0", port: 8443, tls: true });
	});

	test("NIGHTSHIFT_TLS_PORT", () => {
		expect(tlsPortOf("8443")).toBe(8443);
		expect(tlsPortOf(undefined)).toBeUndefined();
		expect(tlsPortOf("")).toBeUndefined();
		expect(tlsPortOf("https")).toBeUndefined();
	});
});

describe("serveDaemon", () => {
	test.skipIf(!Bun.which("openssl"))(
		"with a certificate, this computer gets http and the others https, from one daemon",
		async () => {
			const tls = selfSigned();
			const daemon: DaemonServe = {
				hostname: "127.0.0.1",
				tls,
				fetch: (request) => new Response(new URL(request.url).protocol),
				websocket: { message() {} },
			};
			const [plain, secure] = serveDaemon(daemon, { port: 0, tlsPort: 0 });
			try {
				expect(plain?.url.protocol).toBe("http:");
				expect(secure?.url.protocol).toBe("https:");
				expect(await (await fetch(plain?.url as URL)).text()).toBe("http:");
				const answer = await fetch(secure?.url as URL, {
					tls: { ca: tls.cert },
				});
				expect(await answer.text()).toBe("https:");
			} finally {
				plain?.stop(true);
				secure?.stop(true);
			}
		},
	);
});
