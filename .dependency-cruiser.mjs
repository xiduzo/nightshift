/**
 * The import rules of the rings (H1, H2, H3, H5 and H8 of the hexagon
 * series, and the rule for `adapters/in/`), for dependency-cruiser.
 *
 * A slice of a server package has three rings. Imports point inward:
 * `adapters/` -> `application/` -> `domain/`. `scripts/check-rings.ts` says
 * what a slice is, and holds the file rules (H6, H7) and the debt list (H10).
 *
 *   bun run check:rings     the ring check: these rules and the file rules
 *
 * Run the rules through that command. It skips the verticals on
 * `scripts/hexagon-debt.txt` and the mechanisms of `scripts/capabilities.ts`.
 * Plain `depcruise` reads this file too, but it reports every vertical.
 *
 * A rule matches the path an import resolves to, from the repository root:
 * `@nightshift/time` is `packages/time/src/index.ts`, `node:fs` is `fs`,
 * and `zod` is a path in `node_modules/zod/`.
 *
 * A test is what `isTest` of `scripts/check-layers.ts` calls one: a
 * `*.test.ts` file, a `test-support.ts` file, a file in a `testing/` or
 * `fixtures/` folder, and the test code of the driven adapters
 * (`adapters/out/in-memory-*.ts`, `adapters/out/*.contract.ts`).
 */

/** The server packages: the ones whose capabilities get rings. */
export const SERVER_PACKAGES = [
	"engine",
	"devices",
	"notifications",
	"agents",
	"auth",
	"telemetry",
];

/**
 * The kernel of a package: its pure mechanisms, which every `domain/` and
 * `application/` of the package may import through their barrels. A kernel
 * mechanism imports no database, folder, process or network module (the
 * rule `kernel-outside-world`), and uses no `Bun`, `fetch` or `process`
 * (`biome.json`).
 *
 * Shape: { package: ["vertical"] }
 */
export const PACKAGE_KERNEL = {
	// The types the engine's ports name, and a run's status with the actions
	// it allows.
	engine: ["contract", "run-status"],
	// The peer protocol: the procedures a Device calls on its Host.
	devices: ["contract"],
	// The notification keys, the push data and where a tap goes.
	notifications: ["contract"],
};

const PKG = `(${SERVER_PACKAGES.join("|")})`;

/** The folders of the kernel mechanisms, as one pattern per package. */
const kernelOf = (after) =>
	Object.entries(PACKAGE_KERNEL).map(
		([pkg, verticals]) =>
			`^packages/${pkg}/src/(?:${verticals.join("|")})/${after}`,
	);

/** A file of a ring. Group 1 is the package, group 2 the slice. */
const inRing = (ring) => `^packages/${PKG}/src/(.+?)/${ring}/`;

/** A test file of a ring, with the same groups. */
const testInRing = (ring) =>
	`${inRing(ring)}.*(?:\\.test|(?<=/)test-support)\\.tsx?$`;

/** An in-memory adapter: a file `in-memory-*.ts` directly in `adapters/out/`. */
const IN_MEMORY = "/adapters/out/in-memory-[^/]*\\.tsx?$";

export const TESTS = [
	"\\.test\\.tsx?$",
	"(^|/)test-support\\.tsx?$",
	"(^|/)(testing|fixtures)/",
	IN_MEMORY,
	"/adapters/out/[^/]*\\.contract\\.tsx?$",
];

/**
 * The kernel: what every ring may import. `refusal`, `time` and `semconv`
 * by any entry but `./testing`, the root of `flows`, the barrels of the
 * package's own kernel (PACKAGE_KERNEL), `zod` (a schema is domain), and
 * `node:crypto` for a pure computation (an HMAC, a constant-time compare).
 */
const KERNEL = [
	"^packages/(?:refusal|time|semconv)/src/(?!testing/)",
	"^packages/flows/src/index\\.ts$",
	...kernelOf("index\\.ts$"),
	"(^|/)node_modules/zod/",
	"^zod(/|$)",
	"^(?:node:)?crypto$",
];

/** What a test of a ring may import on top: the test runner and the kernel's `./testing`. */
const KERNEL_FOR_TESTS = [
	"^bun:test$",
	"^packages/(?:refusal|time|semconv|flows)/src/testing/",
];

const OWN_DOMAIN = "^packages/$1/src/$2/domain/";
const OWN_APPLICATION = "^packages/$1/src/$2/application/";

/**
 * The barrel of another slice of the package: an `index.ts` in a folder of
 * `src/`, at any depth. Not the slice's own barrel, not the root index of
 * the package, not a file of a ring, not a test helper.
 */
const OTHER_BARREL =
	"^packages/$1/src/(?!$2/index\\.ts$)(?!testing/)(?!.*(?<=/)(?:domain|application|adapters)/).+/index\\.ts$";

/**
 * A public entry of another `@nightshift` package. A file of another
 * workspace resolves only through its package.json `exports`, and the
 * layer check says which package may import which.
 */
const OTHER_PACKAGE = "^packages/(?!$1/)[^/]+/src/";

/** The shared kernel packages, by the entries a ring may import as values. */
const KERNEL_PACKAGES = [
	"^packages/(?:refusal|time|semconv)/src/(?!testing/)",
	"^packages/flows/src/index\\.ts$",
];

const PACKAGE_VALUE =
	"application/ imports only types from another package (import type), apart from the kernel. What the package does comes in through a port (H2).";

/** An in-memory adapter of any slice of the package. */
const IN_MEMORY_OF_PACKAGE = `^packages/$1/src/.+${IN_MEMORY}`;

/** H3: what touches a database, a folder, a process or the network. */
const OUTSIDE_WORLD = [
	"^packages/db/",
	"^@nightshift/db(/|$)",
	"(^|/)node_modules/(?:drizzle-orm|yjs|@libsql/[^/]+|@langchain/[^/]+|@hocuspocus/[^/]+)/",
	"^(?:drizzle-orm|yjs|@libsql/[^/]+|@langchain/[^/]+|@hocuspocus/[^/]+)(/|$)",
	"^bun:sqlite$",
	"^(?:node:)?(?:fs|child_process|net|https?|http2|dns)(/|$)",
];

/** H5: a real adapter is a file in `adapters/out/` that is not test code. */
const REAL_ADAPTER = {
	path: `^packages/${PKG}/src/.+/adapters/out/`,
	pathNot: TESTS,
};

/** The `wire.ts` of a slice. Group 1 is the folder of the slice. */
const SLICE_WIRE = "^(packages/[^/]+/src/.+)/wire\\.ts$";

const H5 =
	"Only the wire.ts of its slice, a file of its adapters/out/ and a test import a real adapter (H5).";

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
	forbidden: [
		{
			name: "h1-domain",
			severity: "error",
			comment:
				"domain/ imports only its own domain/, the kernel of its package (the barrel of contract/, and of run-status/ in the engine), the shared kernel (@nightshift/refusal, @nightshift/time, @nightshift/semconv, the @nightshift/flows root), zod and node:crypto (H1).",
			from: { path: inRing("domain"), pathNot: TESTS },
			to: { pathNot: [OWN_DOMAIN, ...KERNEL] },
		},
		{
			name: "h1-domain-test",
			severity: "error",
			comment:
				"A test in domain/ imports only what domain/ may import, bun:test and the ./testing entry of a kernel package (H1).",
			from: { path: testInRing("domain") },
			to: { pathNot: [OWN_DOMAIN, ...KERNEL, ...KERNEL_FOR_TESTS] },
		},
		{
			name: "h2-application",
			severity: "error",
			comment:
				"application/ imports only its own domain/ and application/, the barrel of another vertical of the package, types of another package, and what domain/ may import. Never adapters/ (H2).",
			from: { path: inRing("application"), pathNot: TESTS },
			to: {
				pathNot: [
					OWN_DOMAIN,
					OWN_APPLICATION,
					OTHER_BARREL,
					OTHER_PACKAGE,
					...KERNEL,
				],
			},
		},
		{
			name: "h2-package-value",
			severity: "error",
			comment: PACKAGE_VALUE,
			from: { path: inRing("application"), pathNot: TESTS },
			to: {
				path: OTHER_PACKAGE,
				pathNot: KERNEL_PACKAGES,
				dependencyTypesNot: ["type-only"],
			},
		},
		{
			name: "h2-package-value-test",
			severity: "error",
			comment: PACKAGE_VALUE,
			from: { path: testInRing("application") },
			to: {
				path: OTHER_PACKAGE,
				pathNot: [...KERNEL_PACKAGES, ...KERNEL_FOR_TESTS],
				dependencyTypesNot: ["type-only"],
			},
		},
		{
			name: "h2-application-test",
			severity: "error",
			comment:
				"A use-case test imports only what application/ may import, in-memory adapters, bun:test and the ./testing entry of a kernel package. It starts no database, folder or process (H2, H8).",
			from: { path: testInRing("application") },
			to: {
				pathNot: [
					OWN_DOMAIN,
					OWN_APPLICATION,
					OTHER_BARREL,
					OTHER_PACKAGE,
					IN_MEMORY_OF_PACKAGE,
					...KERNEL,
					...KERNEL_FOR_TESTS,
				],
			},
		},
		{
			name: "h3-outside-world",
			severity: "error",
			comment:
				"Only adapters/out/ imports the database, a folder, a process, the network, Yjs or LangChain. A type-only import counts, and so does a test (H3, H8).",
			from: { path: inRing("(?:domain|application)") },
			to: { path: OUTSIDE_WORLD },
		},
		{
			name: "kernel-outside-world",
			severity: "error",
			comment:
				"A kernel mechanism imports no database, folder, process or network module, type-only imports included: every domain/ of its package may import it (H3).",
			from: { path: kernelOf(""), pathNot: TESTS },
			to: { path: OUTSIDE_WORLD },
		},
		{
			name: "h5-real-adapter-from-adapter",
			severity: "error",
			comment: `${H5} An adapter imports no real adapter of another slice.`,
			from: {
				path: "^(packages/[^/]+/src/.+?)/adapters/out/",
				pathNot: TESTS,
			},
			to: {
				path: REAL_ADAPTER.path,
				pathNot: ["^$1/adapters/out/", ...TESTS],
			},
		},
		{
			name: "h5-real-adapter-from-wire",
			severity: "error",
			comment: `${H5} A wire.ts builds the adapters of its own slice, and calls the wire function of another slice.`,
			from: { path: SLICE_WIRE },
			to: {
				path: REAL_ADAPTER.path,
				pathNot: ["^$1/adapters/out/", ...TESTS],
			},
		},
		{
			name: "h5-real-adapter",
			severity: "error",
			comment: `${H5} A barrel never passes one on: it exports the wire function of the slice.`,
			from: {
				pathNot: ["/adapters/out/", SLICE_WIRE, ...TESTS],
			},
			to: REAL_ADAPTER,
		},
		{
			name: "adapters-in",
			severity: "error",
			comment:
				"A driving adapter in adapters/in/ imports nothing of its slice. The wire.ts hands it the bound use case.",
			from: { path: inRing("adapters/in"), pathNot: TESTS },
			to: {
				path: "^packages/$1/src/$2/",
				pathNot: "^packages/$1/src/$2/adapters/in/",
			},
		},
	],
	options: {
		// The rules need the files of the server packages only. What they
		// import is resolved, but not read in turn.
		doNotFollow: {
			path: ["node_modules", `^packages/(?!${PKG}/)`, "^apps/"],
		},
		// TypeScript 7.0 has no compiler API for dependency-cruiser (it takes
		// below 7.0, or 7.1 and later), so swc reads the files. It reads the
		// type-only imports too. It does not read a type written as
		// `import("x").Name` inside a declaration:
		// `scripts/rings/import-types.ts` fails that form where a rule
		// applies. With TypeScript 7.1, set `parser: "tsc"` and
		// `tsPreCompilationDeps: true`, and remove that module and @swc/core.
		parser: "swc",
		// A workspace package resolves through its package.json `exports`,
		// which name TypeScript files.
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["import", "require", "node", "default", "types"],
			extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
		},
	},
};
