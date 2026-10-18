import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	appDataDir,
	databaseUrl,
	legacyData,
	resolveDataDir,
} from "./data-dir";

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

describe("legacyData", () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function setup() {
		dir = mkdtempSync(join(tmpdir(), "ns-data-"));
		const home = join(dir, "home");
		const root = join(dir, "checkout");
		const dataDir = join(dir, "data");
		mkdirSync(join(home, ".nightshift", "transcripts", "run"), {
			recursive: true,
		});
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "local.db"), "");
		return { home, root, dataDir };
	}

	test("lists the old database and transcripts", () => {
		const paths = setup();
		expect(legacyData({ ...paths, databaseUrlSet: false })).toEqual({
			database: join(paths.root, "local.db"),
			files: [join(paths.home, ".nightshift", "transcripts")],
		});
	});

	test("ignores the old database when DATABASE_URL is set or the new one exists", () => {
		const paths = setup();
		expect(legacyData({ ...paths, databaseUrlSet: true }).database).toBeNull();
		mkdirSync(paths.dataDir);
		writeFileSync(join(paths.dataDir, "nightshift.db"), "");
		expect(legacyData({ ...paths, databaseUrlSet: false }).database).toBeNull();
	});

	test("lists nothing when the data directory is the old one", () => {
		const paths = setup();
		expect(
			legacyData({
				...paths,
				dataDir: join(paths.home, ".nightshift"),
				databaseUrlSet: true,
			}),
		).toEqual({ database: null, files: [] });
	});
});
