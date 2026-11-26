import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	answersAt,
	type DaemonServe,
	ListenError,
	listeners,
	PortTakenError,
	portOf,
	serveDaemon,
} from "./serve";

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

	test("a port of the environment", () => {
		expect(portOf("8443")).toBe(8443);
		expect(portOf(undefined)).toBeUndefined();
		expect(portOf("")).toBeUndefined();
		expect(portOf("https")).toBeUndefined();
		expect(portOf("0")).toBeUndefined();
		expect(portOf("65535")).toBe(65_535);
		expect(portOf("65536")).toBeUndefined();
	});
});

describe("serveDaemon", () => {
	const plainDaemon: DaemonServe = {
		hostname: "127.0.0.1",
		fetch: () => new Response("OK"),
		websocket: { message() {} },
	};

	/** A server that another program runs, on a port of its own. */
	function otherProgram() {
		return Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => new Response("other"),
		});
	}

	test("given a port that another program has, when the daemon listens, then it throws a PortTakenError with that port", () => {
		const other = otherProgram();
		try {
			const listen = () =>
				serveDaemon(plainDaemon, { port: other.port as number });

			expect(listen).toThrow(PortTakenError);
			expect(listen).toThrow(
				`Night Shift cannot listen on port ${other.port}: another program uses it. Stop that program or start Night Shift with another port.`,
			);
		} finally {
			other.stop(true);
		}
	});

	test("given a port that another program has, the daemon's check of the address leaves no listener behind", () => {
		const other = otherProgram();
		const serve = Bun.serve;
		const made: Bun.Server<undefined>[] = [];
		const stopped: Bun.Server<undefined>[] = [];
		const spy = spyOn(Bun, "serve").mockImplementation(((
			options: Parameters<typeof Bun.serve>[0],
		) => {
			const server = serve(options as never) as Bun.Server<undefined>;
			made.push(server);
			const stop = server.stop.bind(server);
			server.stop = (force?: boolean) => {
				stopped.push(server);
				return stop(force);
			};
			return server;
		}) as typeof Bun.serve);
		try {
			expect(() =>
				serveDaemon(plainDaemon, { port: other.port as number }),
			).toThrow(PortTakenError);
		} finally {
			spy.mockRestore();
			other.stop(true);
		}
		// The listen failed: only the check of the address made a server.
		expect(made).toHaveLength(1);
		expect(stopped).toEqual(made);
	});

	test("given an address that is not this computer's, when the daemon listens, then it names the address, not the port", () => {
		// TEST-NET-1 (RFC 5737): never an address of this computer.
		const listen = () =>
			serveDaemon({ ...plainDaemon, hostname: "192.0.2.1" }, { port: 0 });

		expect(listen).toThrow(ListenError);
		expect(listen).not.toThrow(PortTakenError);
		expect(listen).toThrow(
			"Night Shift cannot listen on 192.0.2.1: this computer has no such address. Use an address of this computer, for example 127.0.0.1.",
		);
	});

	test.skipIf(!Bun.which("openssl"))(
		"given the https port is taken, when the daemon listens, then it stops the http listener it started and names the https port",
		() => {
			const other = otherProgram();
			const free = otherProgram();
			const port = free.port as number;
			free.stop(true);
			try {
				const error = (() => {
					try {
						serveDaemon(
							{ ...plainDaemon, tls: selfSigned() },
							{ port, tlsPort: other.port as number },
						);
						return null;
					} catch (thrown) {
						return thrown;
					}
				})();

				expect(error).toBeInstanceOf(PortTakenError);
				expect((error as PortTakenError).port).toBe(other.port as number);
				// The http listener on `port` is gone: the port is free again.
				const again = Bun.serve({
					port,
					hostname: "127.0.0.1",
					fetch: () => new Response(),
				});
				again.stop(true);
			} finally {
				other.stop(true);
			}
		},
	);

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

describe("where a listener answers, for the log", () => {
	test("its address", () => {
		const [server] = serveDaemon(
			{
				hostname: "127.0.0.1",
				fetch: () => new Response("OK"),
				websocket: { message() {} },
			},
			{ port: 0 },
		);
		try {
			expect(answersAt(server as Bun.Server<never>)).toBe(
				`http://127.0.0.1:${server?.port}/`,
			);
		} finally {
			server?.stop(true);
		}
	});

	// The loopback interface has a link-local address with this name on macOS.
	test.skipIf(process.platform !== "darwin")(
		"an IPv6 address with a zone, which Bun's url cannot write",
		() => {
			const [server] = serveDaemon(
				{
					hostname: "fe80::1%lo0",
					fetch: () => new Response("OK"),
					websocket: { message() {} },
				},
				{ port: 0 },
			);
			try {
				expect(answersAt(server as Bun.Server<never>)).toBe(
					`http://[fe80::1%lo0]:${server?.port}/`,
				);
			} finally {
				server?.stop(true);
			}
		},
	);
});
