import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { appDataDir, databaseUrl, resolveDataDir } from "./data-dir";

const mac = { platform: "darwin" as const, home: "/Users/ada", env: {} };

describe("appDataDir", () => {
	test("macOS: Application Support", () => {
		expect(appDataDir(mac)).toBe(
			"/Users/ada/Library/Application Support/Night Shift",
		);
	});

	test("Linux: XDG_DATA_HOME, else ~/.local/share", () => {
		const linux = { platform: "linux" as const, home: "/home/ada", env: {} };
		expect(appDataDir(linux)).toBe("/home/ada/.local/share/nightshift");
		expect(appDataDir({ ...linux, env: { XDG_DATA_HOME: "/data" } })).toBe(
			"/data/nightshift",
		);
	});

	test("Windows: APPDATA", () => {
		expect(
			appDataDir({
				platform: "win32",
				home: "/c/ada",
				env: { APPDATA: "/c/ada/AppData/Roaming" },
			}),
		).toBe(join("/c/ada/AppData/Roaming", "Night Shift"));
	});
});

describe("resolveDataDir", () => {
	test("defaults to the app data directory", () => {
		expect(resolveDataDir({}, mac, "/src/nightshift")).toBe(appDataDir(mac));
	});

	test("dev mode: .nightshift-dev in the checkout", () => {
		expect(
			resolveDataDir({ NIGHTSHIFT_DEV: true }, mac, "/src/nightshift"),
		).toBe("/src/nightshift/.nightshift-dev");
	});

	test("NIGHTSHIFT_DATA_DIR wins, with ~ expanded and relative paths resolved", () => {
		expect(
			resolveDataDir(
				{ NIGHTSHIFT_DATA_DIR: "~/night", NIGHTSHIFT_DEV: true },
				mac,
			),
		).toBe("/Users/ada/night");
		expect(resolveDataDir({ NIGHTSHIFT_DATA_DIR: "data" }, mac)).toBe(
			resolve("data"),
		);
	});

	test("a blank NIGHTSHIFT_DATA_DIR counts as unset", () => {
		expect(resolveDataDir({ NIGHTSHIFT_DATA_DIR: " " }, mac)).toBe(
			appDataDir(mac),
		);
	});
});

describe("databaseUrl", () => {
	test("defaults to nightshift.db in the data directory", () => {
		expect(databaseUrl({}, "/data/Night Shift")).toBe(
			"file:/data/Night Shift/nightshift.db",
		);
	});

	test("an explicit DATABASE_URL wins", () => {
		expect(databaseUrl({ DATABASE_URL: "libsql://x.turso.io" }, "/d")).toBe(
			"libsql://x.turso.io",
		);
		expect(databaseUrl({ DATABASE_URL: "" }, "/d")).toBe(
			"file:/d/nightshift.db",
		);
	});
});
