import { describe, expect, test } from "bun:test";

import { serveOptions } from "./cli";

describe("nightshift serve", () => {
	test("this computer only, at the default port, without flags", () => {
		expect(serveOptions([], {})).toEqual({
			port: 3000,
			tlsPort: undefined,
			env: {},
			url: "http://localhost:3000",
			web: null,
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

	test("refuses what it does not know", () => {
		expect(() => serveOptions(["--prot", "1"], {})).toThrow(
			"There is no option --prot.",
		);
		expect(() => serveOptions(["--port"], {})).toThrow("needs a value");
		expect(() => serveOptions(["--port", "http"], {})).toThrow("is not a port");
	});
});
