import { dirname, join } from "node:path";

import type { ElectrobunConfig } from "electrobun";

import { UPDATE_FEEDS } from "./src/bun/update-feeds";

const webBuildDir = "../web/dist/client";
// The packaged app has no .env files and no varlock CLI (see the shims).
const varlockShims = {
	"varlock/auto-load": Bun.resolveSync(
		"server/shims/varlock-auto-load",
		import.meta.dir,
	),
	"varlock/env": Bun.resolveSync("server/shims/varlock-env", import.meta.dir),
};

/**
 * libsql loads its native binary from `@libsql/<platform>` at run time, which
 * the bundle cannot inline. Ship that package next to the bundle, from the
 * copy that `libsql` itself resolves.
 */
function libsqlNativePackage(): string {
	const target = {
		darwin: `darwin-${process.arch}`,
		linux: `linux-${process.arch}-gnu`,
		win32: `win32-${process.arch}-msvc`,
	}[process.platform as "darwin" | "linux" | "win32"];
	const libsql = Bun.resolveSync(
		"libsql/package.json",
		join(import.meta.dir, "../../packages/db"),
	);
	return dirname(
		Bun.resolveSync(`@libsql/${target}/package.json`, dirname(libsql)),
	);
}
const libsqlNative = libsqlNativePackage();

// The release workflows set these. A local build is a stable build of 0.1.0.
const version = process.env.NIGHTSHIFT_VERSION || "0.1.0";
const feed =
	process.env.NIGHTSHIFT_UPDATE_FEED === "nightly" ? "nightly" : "stable";
// Signing runs only where the Apple credentials are set (see docs/releasing.md).
const codesign = Boolean(process.env.ELECTROBUN_DEVELOPER_ID);
const notarize =
	codesign &&
	Boolean(process.env.ELECTROBUN_APPLEID || process.env.ELECTROBUN_APPLEAPIKEY);

export default {
	app: {
		name: "Night Shift",
		identifier: "dev.bettertstack.nightshift.desktop",
		version,
	},
	runtime: {
		// The daemon keeps running runs with no window open. Quit from the menu bar.
		exitOnLastWindowClosed: false,
	},
	build: {
		// The daemon needs full Bun: libsql, the keychain (Bun.secrets) and the
		// harness CLIs it spawns.
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
			alias: varlockShims,
			// An optional peer of @tanstack/ai-sandbox, imported only when used.
			external: ["@tanstack/ai-persistence"],
		},
		copy: {
			[webBuildDir]: "views/mainview",
			// `@nightshift/db` finds its migrations next to the module that runs.
			"../../packages/db/src/migrations": "bun/migrations",
			// A Worker's own file, next to the bundle that starts it (Bun runs it as is).
			"src/bun/watchdog-worker.ts": "bun/watchdog-worker.ts",
			[libsqlNative]: `bun/node_modules/@libsql/${libsqlNative.split("/").pop()}`,
		},
		watchIgnore: [`${webBuildDir}/**`],
		mac: {
			codesign,
			notarize,
			bundleCEF: true,
			defaultRenderer: "cef",
		},
		linux: {
			bundleCEF: true,
			defaultRenderer: "cef",
		},
		win: {
			bundleCEF: true,
			defaultRenderer: "cef",
		},
	},
	release: {
		baseUrl: UPDATE_FEEDS[feed],
		// A patch diffs against the last release on the feed. Only the release
		// workflows download it: they set NIGHTSHIFT_VERSION.
		generatePatch: Boolean(process.env.NIGHTSHIFT_VERSION),
	},
} satisfies ElectrobunConfig;
