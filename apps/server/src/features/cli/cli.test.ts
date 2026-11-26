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
		for (const listen of ["127.0.0.1:3000", ":::", "http://localhost"])
			expect(() => serveOptions(["--listen", listen], {})).toThrow(
				`${listen} is not an address to listen on.`,
			);
		expect(() => serveOptions([], { NIGHTSHIFT_LISTEN: "studio lan" })).toThrow(
			"studio lan is not an address to listen on.",
		);
		for (const listen of ["::1", "[::1]", "studio.lan"])
			expect(() => serveOptions(["--listen", listen], {})).not.toThrow();
	});

	test("a bad port or --listen ends it with exit code 2 before anything starts", () => {
		for (const [flag, value, words] of [
			["--tls-port", "https", "https is not a port."],
			[
				"--listen",
				"127.0.0.1:3000",
				"127.0.0.1:3000 is not an address to listen on.",
			],
		] as const) {
			const root = mkdtempSync(join(tmpdir(), "nightshift-serve-"));
			try {
				const dataDir = join(root, "data");
				const ended = Bun.spawnSync(
					[
						process.execPath,
						resolve(import.meta.dir, "../../cli.ts"),
						...["serve", "--data-dir", dataDir, flag, value],
					],
					// A daemon that starts all the same takes no real data and no port.
					{
						cwd: root,
						env: { PATH: process.env.PATH, HOME: root, PORT: "9" },
						timeout: 20_000,
					},
				);
				expect(ended.stderr.toString()).toStartWith(`${words}`);
				expect(ended.exitCode).toBe(2);
				expect(existsSync(dataDir)).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	}, 45_000);
});
