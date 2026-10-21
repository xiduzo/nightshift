import { dirname, join } from "node:path";

import type { ElectrobunConfig } from "electrobun";

// The feeds only (pure data): the barrel of updates loads electrobun/main.
import { UPDATE_FEEDS } from "./src/features/updates/update-feeds";

const webBuildDir = "../web/dist/client";

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

/**
 * The watchdog runs in a Worker, from its own file next to the bundle: Bun
 * starts a Worker from a file and does not bundle it with the main process.
 * So the worker is bundled here on its own, with what it imports
 * (`@nightshift/daemon/heartbeat`). The file keeps the name the app starts
 * it by (`watchdog-worker.ts`). Bun runs the bundled JavaScript in it as it is.
 */
async function bundleWatchdogWorker(): Promise<string> {
	const outdir = join(import.meta.dir, "node_modules/.cache/watchdog");
	const result = await Bun.build({
		entrypoints: [
			join(import.meta.dir, "src/features/watchdog/watchdog-worker.ts"),
		],
		outdir,
		naming: "[name].ts",
		target: "bun",
	});
	if (!result.success) {
		throw new AggregateError(
			result.logs,
			"The watchdog worker did not bundle.",
		);
	}
	return join(outdir, "watchdog-worker.ts");
}
const watchdogWorker = await bundleWatchdogWorker();

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
			// An optional peer of @tanstack/ai-sandbox, imported only when used.
			external: ["@tanstack/ai-persistence"],
		},
		copy: {
			[webBuildDir]: "views/mainview",
			// `@nightshift/db` finds its migrations next to the module that runs.
			"../../packages/db/src/migrate/migrations": "bun/migrations",
			// A Worker's own file, next to the bundle that starts it.
			[watchdogWorker]: "bun/watchdog-worker.ts",
			[libsqlNative]: `bun/node_modules/@libsql/${libsqlNative.split("/").pop()}`,
		},
		// The worker is no entrypoint and its bundle is in node_modules: watch its source.
		watch: ["src/features/watchdog"],
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
