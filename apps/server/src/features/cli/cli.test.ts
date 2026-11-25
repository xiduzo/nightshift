import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { serveOptions } from "./cli";

describe("nightshift serve", () => {
	test("this computer only, at the default port, without flags", () => {
		expect(serveOptions([], {})).toEqual({
			port: 3000,
			tlsPort: undefined,
			env: {},
			url: "http://localhost:3000",
			web: null,
			requireTwoFactor: false,
		});
	});

	test("Host addresses make it a Host, and its first https:// one its own address", () => {
		const options = serveOptions(
			[
				"--port",
				"4000",
				"--data-dir",
				"/srv/nightshift",
				"--host-address",
				"https://studio.local:4443",
				"--host-address",
				"https://nightshift.example.com",
				"--listen",
				"127.0.0.1",
			],
			{},
		);
		expect(options.port).toBe(4000);
		expect(options.url).toBe("https://studio.local:4443");
		expect(options.env).toEqual({
			PORT: "4000",
			NIGHTSHIFT_DATA_DIR: "/srv/nightshift",
			NIGHTSHIFT_HOST: "on",
			NIGHTSHIFT_HOST_ADDRESSES:
				"https://studio.local:4443,https://nightshift.example.com",
			NIGHTSHIFT_LISTEN: "127.0.0.1",
		});
	});

	test("the environment counts where no flag is given", () => {
		const options = serveOptions([], {
			PORT: "3100",
			NIGHTSHIFT_HOST_ADDRESSES:
				"http://localhost:3100, https://ns.example.com",
			NIGHTSHIFT_TLS_PORT: "8443",
			NIGHTSHIFT_WEB_DIR: "/opt/web",
		});
		expect(options.port).toBe(3100);
		expect(options.tlsPort).toBe(8443);
		expect(options.url).toBe("https://ns.example.com");
		expect(options.web).toBe("/opt/web");
		expect(options.env).toEqual({});
	});

	test("--require-two-factor, or NIGHTSHIFT_REQUIRE_TWO_FACTOR", () => {
		const flag = serveOptions(["--require-two-factor"], {});
		expect(flag.requireTwoFactor).toBe(true);
		expect(flag.env).toEqual({ NIGHTSHIFT_REQUIRE_TWO_FACTOR: "on" });
		const fromEnv = serveOptions([], { NIGHTSHIFT_REQUIRE_TWO_FACTOR: "on" });
		expect(fromEnv.requireTwoFactor).toBe(true);
		expect(fromEnv.env).toEqual({});
		expect(
			serveOptions([], { NIGHTSHIFT_REQUIRE_TWO_FACTOR: "off" })
				.requireTwoFactor,
		).toBe(false);
		expect(() =>
			serveOptions([], { NIGHTSHIFT_REQUIRE_TWO_FACTOR: "maybe" }),
		).toThrow("Use on or off.");
	});

	test("refuses what it does not know", () => {
		expect(() => serveOptions(["--prot", "1"], {})).toThrow(
			"There is no option --prot.",
		);
		expect(() => serveOptions(["--port"], {})).toThrow("needs a value");
		expect(() => serveOptions(["--port", "http"], {})).toThrow("is not a port");
		for (const port of ["https", "0", "-1", "70000", "84.5"])
			expect(() => serveOptions(["--tls-port", port], {})).toThrow(
				`${port} is not a port.`,
			);
		expect(() => serveOptions([], { NIGHTSHIFT_TLS_PORT: "https" })).toThrow(
			"https is not a port.",
		);
	});

	test("a bad port ends it with exit code 2 before anything starts", () => {
		const root = mkdtempSync(join(tmpdir(), "nightshift-serve-"));
		try {
			const dataDir = join(root, "data");
			const ended = Bun.spawnSync(
				[
					process.execPath,
					resolve(import.meta.dir, "../../cli.ts"),
					...["serve", "--data-dir", dataDir, "--tls-port", "https"],
				],
				// A daemon that starts all the same takes no real data and no port.
				{
					cwd: root,
					env: { PATH: process.env.PATH, HOME: root, PORT: "9" },
					timeout: 20_000,
				},
			);
			expect(ended.stderr.toString()).toStartWith("https is not a port.\n");
			expect(ended.exitCode).toBe(2);
			expect(existsSync(dataDir)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 30_000);

	test("NIGHTSHIFT_LISTEN that is not an address stops the start, and says why", () => {
		const root = mkdtempSync(join(tmpdir(), "nightshift-serve-"));
		try {
			const ended = Bun.spawnSync(
				[
					process.execPath,
					resolve(import.meta.dir, "../../cli.ts"),
					// Not a Host: the value is checked all the same.
					...["serve", "--data-dir", join(root, "data")],
				],
				// Where `.env.schema` is, so the daemon reads its environment.
				{
					cwd: resolve(import.meta.dir, "../../.."),
					env: {
						PATH: process.env.PATH,
						HOME: root,
						PORT: "9",
						NIGHTSHIFT_KEY_STORE: "file",
						NIGHTSHIFT_SCHEDULER: "off",
						NIGHTSHIFT_DESKTOP_NOTIFICATIONS: "off",
						NIGHTSHIFT_LISTEN: "127.0.0.1:3000",
					},
					timeout: 30_000,
				},
			);
			expect(ended.stderr.toString()).toContain(
				"127.0.0.1:3000 is not an address to listen on. Use an IP address or a host name, for example 127.0.0.1.",
			);
			expect(ended.stdout.toString()).not.toContain("Night Shift answers at");
			expect(ended.exitCode).not.toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 45_000);
});
