import { dirname, join } from "node:path";

import type { ElectrobunConfig } from "electrobun";

const webBuildDir = "../web/dist/client";
const shims = join(import.meta.dir, "../server/src/shims");
// The packaged app has no .env files and no varlock CLI (see the shims).
const varlockShims = {
	"varlock/auto-load": join(shims, "varlock-auto-load.ts"),
	"varlock/env": join(shims, "varlock-env.ts"),
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

export default {
	app: {
		name: "Night Shift",
		identifier: "dev.bettertstack.nightshift.desktop",
		version: "0.1.0",
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
			[libsqlNative]: `bun/node_modules/@libsql/${libsqlNative.split("/").pop()}`,
		},
		watchIgnore: [`${webBuildDir}/**`],
		mac: {
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
} satisfies ElectrobunConfig;
