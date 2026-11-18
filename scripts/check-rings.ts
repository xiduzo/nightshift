/**
 * Checks the rings of a slice (the guardrails H1 to H8 and H10 of the
 * hexagon series).
 *
 * A slice is a vertical of a server package (`engine`, `devices`,
 * `notifications`, `agents`, `auth`, `telemetry`) that
 * `scripts/capabilities.ts` gives a capability, and each sub-vertical of
 * it. A mechanism has no rings: these rules do not cover it. Imports point
 * inward: `adapters/` -> `application/` -> `domain/`.
 *
 * A slice is in shape when all of this holds:
 * - Its own folder holds only `index.ts` (the barrel), `wire.ts` and tests
 *   (`*.test.ts`, `test-support.ts`).
 * - Each folder in it is a ring (`domain/`, `application/`, `adapters/`) or
 *   a sub-vertical: a folder with its own `index.ts` that is in shape too.
 * - It has `domain/` or `application/`, or a sub-vertical.
 * - `adapters/` holds only `out/` (the driven adapters) and `in/` (a
 *   driving adapter that is not the API: a timer, a listener).
 * - `application/` is flat: no folder in it.
 * - No folder below a ring is named `domain`, `application` or `adapters`.
 * - A slice with `application/` has a `wire.ts`. It exports one function,
 *   `wire<Slice>` (`schedules/wire.ts` exports `wireSchedules`), and types.
 *   It builds the real adapters of the slice and returns the use cases
 *   bound to their ports. The barrel exports that function and types.
 *
 * The import rules (`.dependency-cruiser.mjs`, run by dependency-cruiser):
 * (H1) `domain/` imports only its own `domain/` and the kernel. The
 *      shared kernel is `@nightshift/refusal`, `@nightshift/time`,
 *      `@nightshift/semconv`, the root of `@nightshift/flows`, `zod` (a
 *      schema is domain) and `node:crypto` (a pure computation, never a
 *      random value). The kernel of a package is its pure mechanisms, by
 *      their barrels: PACKAGE_KERNEL of `.dependency-cruiser.mjs`
 *      (`contract/`, and `run-status/` in the engine).
 * (H2) `application/` imports only its own `domain/` and `application/`,
 *      the barrel of another vertical of its package, and what H1 allows.
 *      Never `adapters/`. From a mechanism that is not kernel, and from
 *      a public entry of another `@nightshift` package, it imports only
 *      types (`import type`): what they do comes in through a port.
 *      `@nightshift/db` stays out, as a type too (H3).
 * (H3) Neither imports `@nightshift/db`, `drizzle-orm`, `@libsql/*`,
 *      `bun:sqlite`, `node:fs`, `node:child_process`, `node:net`,
 *      `node:http*`, `node:dns*`, `yjs`, `@langchain/*` or `@hocuspocus/*`.
 *      A type-only import counts.
 * (H5) A real adapter is a file in `adapters/out/` that is not test code.
 *      Only the `wire.ts` of its slice, a file of the same `adapters/out/`
 *      and a test import it. So a barrel never passes one on, and no file
 *      of another slice builds one.
 * (H8) A test in `domain/` or `application/` keeps H1, H2 and H3. It may
 *      also import `bun:test` and the `./testing` entry of a kernel
 *      package. A use-case test may also import an in-memory adapter of
 *      its package. It imports no `testing/` folder: that is where a
 *      database starts.
 * (in) A file in `adapters/in/` imports nothing of its slice. The wire
 *      hands it the bound use case.
 * In `domain/`, `application/` and `adapters/in/`, a type is never written
 * as `import("x").Name`, and nowhere when it names a file of `adapters/out/`:
 * the rules read import statements (`scripts/rings/import-types.ts`).
 *
 * (H4) is in `biome.json`: `noRestrictedGlobals` fails `Bun`, `fetch` and
 *      `process` in every `domain/` and `application/` folder of a
 *      package, tests included, and in the kernel of a package. It does
 *      not read the debt list. This check fails when that override does
 *      not name those folders.
 *
 * The kernel of a package is pure: a file of it imports none of the
 * modules of H3, a type-only import included, and writes no type as
 * `import("x").Name`. Tests apart.
 *
 * The file rules:
 * (H6) `application/` holds `ports.ts`, one file per use case and one test
 *      per use case. `ports.ts` exports types only. A use case file is
 *      `<verb>-<object>.ts`. It exports one function, named for the file
 *      (`answer-gate.ts` exports `answerGate`), and types. Its test is
 *      `<verb>-<object>.test.ts`, beside it. A step that two use cases
 *      share is a function in `domain/`.
 * (H7) Every type that `application/ports.ts` exports is a port. A port
 *      `ScheduleStore` has, in `adapters/out/` of its slice:
 *      - `in-memory-schedule-store.ts`: the in-memory adapter. It imports
 *        `ScheduleStore` from `../../application/ports`.
 *      - `<tech>-schedule-store.ts`: the real adapter
 *        (`drizzle-schedule-store.ts`).
 *      - `schedule-store.contract.ts`: the contract suite. It exports one
 *        function, `scheduleStoreContract`, and imports the port.
 *      - `schedule-store.contract.test.ts`: it imports the suite, the
 *        in-memory adapter and a real adapter, and runs the suite on both.
 *      A port that another slice or another package implements says so in
 *      its comment: `@filledBy <package>` or `@filledBy <package>/<vertical>`
 *      (`@filledBy devices`, `@filledBy engine/run`). It has an in-memory
 *      adapter and nothing else: a file `adapters/out/in-memory-*.ts` that
 *      imports the port. One such file may hold the in-memory adapters of
 *      several of these ports (`in-memory-neighbours.ts`).
 * An in-memory adapter and a contract suite are test code (`isTest` of
 * `scripts/check-layers.ts`): production code never imports them.
 *
 * The debt list (H10): `scripts/hexagon-debt.txt` names each vertical that
 * is not in shape yet, as `<package>/<vertical>`. The list only gets
 * shorter:
 * - A vertical that is not listed keeps every rule above.
 * - A listed vertical that keeps every rule, and has an `application/`
 *   folder, fails until its line is gone.
 * - A line that names no vertical, or a mechanism, fails.
 * One case adds a line: a new vertical that splits out of a listed one.
 * A line `kernel <file>` names a file of a package's kernel that is not
 * pure yet. It fails once the file is pure, and a file that is not listed
 * fails.
 *
 *   bun run check:rings          (or: bun scripts/check-rings.ts)
 *
 * Exits 1 and names each problem.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_KERNEL, SERVER_PACKAGES } from "../.dependency-cruiser.mjs";
import { MECHANISM, VERTICALS } from "./capabilities";
import { debtOf } from "./check-time";
import { portProblems, useCaseProblems, wireProblems } from "./rings/files";
import { importTypeViolations } from "./rings/import-types";
import { importViolations, KERNEL_RULE } from "./rings/imports";
import {
	hasApplication,
	shapeProblems,
	slicesOf,
	withSubs,
} from "./rings/slices";

export type Options = {
	/** The text of `scripts/hexagon-debt.txt`. */
	debt: string;
	/**
	 * The mechanisms of `scripts/capabilities.ts`, each as
	 * `<package>/<vertical>`. The ring rules do not cover them.
	 */
	mechanisms?: Iterable<string>;
};

/** The globals that only `adapters/out/` uses (H4). */
const DENIED_GLOBALS = ["Bun", "fetch", "process"];

/**
 * H4 is one override of `biome.json`. Its problems: it is gone, it does
 * not deny every global of H4, or it does not name exactly the `domain/`
 * and `application/` folders and the kernel of each package.
 */
export function biomeProblems(text: string): string[] {
	const expected = [
		"packages/*/src/**/domain/**",
		"packages/*/src/**/application/**",
		...Object.entries(PACKAGE_KERNEL).flatMap(([pkg, verticals]) =>
			verticals.map((vertical) => `packages/${pkg}/src/${vertical}/**`),
		),
	];
	type Override = {
		includes?: string[];
		linter?: {
			rules?: {
				style?: {
					noRestrictedGlobals?: {
						level?: string;
						options?: { deniedGlobals?: Record<string, string> };
					};
				};
			};
		};
	};
	const overrides: Override[] = JSON.parse(text).overrides ?? [];
	const found = overrides.filter(
		(override) => override.linter?.rules?.style?.noRestrictedGlobals,
	);
	const rule = found[0]?.linter?.rules?.style?.noRestrictedGlobals;
	if (found.length !== 1 || !rule) {
		return [
			`biome.json: H4 is one override with style/noRestrictedGlobals. It has ${found.length}.`,
		];
	}
	const problems: string[] = [];
	const denied = Object.keys(rule.options?.deniedGlobals ?? {});
	const lacks = DENIED_GLOBALS.filter((name) => !denied.includes(name));
	if (rule.level !== "error" || lacks.length) {
		problems.push(
			`biome.json: the override with noRestrictedGlobals has the level "error" and denies ${DENIED_GLOBALS.join(", ")} (H4).`,
		);
	}
	const includes = found[0]?.includes ?? [];
	const missing = expected.filter((glob) => !includes.includes(glob));
	const extra = includes.filter((glob) => !expected.includes(glob));
	if (missing.length || extra.length) {
		problems.push(
			`biome.json: the override with noRestrictedGlobals names the domain/ and application/ folders and the kernel of each package (PACKAGE_KERNEL of .dependency-cruiser.mjs).${missing.length ? ` It lacks ${missing.map((glob) => `"${glob}"`).join(", ")}.` : ""}${extra.length ? ` Remove ${extra.map((glob) => `"${glob}"`).join(", ")}.` : ""}`,
		);
	}
	return problems;
}

/** A line of the debt list for a file of a kernel: `kernel <file>`. */
const KERNEL_LINE = /^kernel\s+(\S+)$/;

/**
 * The problems of the server packages under `root` (the repository root),
 * as messages.
 */
export async function checkRings(
	root: string,
	options: Options,
): Promise<string[]> {
	const lines = debtOf(options.debt);
	const listed = lines.filter((line) => !KERNEL_LINE.test(line));
	const kernelListed = lines.flatMap(
		(line) => KERNEL_LINE.exec(line)?.[1] ?? [],
	);
	const mechanisms = new Set(options.mechanisms ?? []);
	const slices = slicesOf(root);
	const keyOf = (slice: { pkg: string; path: string }) =>
		`${slice.pkg}/${slice.path}`;

	const found = await importViolations(root, mechanisms);
	const { problems } = found;
	const all = [...found.violations, ...importTypeViolations(root)];
	const violations = all.filter((v) => v.rule !== KERNEL_RULE);

	// The kernel of each package is pure, apart from the listed files.
	const impure = all.filter((v) => v.rule === KERNEL_RULE);
	for (const violation of impure) {
		if (!kernelListed.includes(violation.file))
			problems.push(violation.message);
	}
	for (const [index, file] of kernelListed.entries()) {
		if (kernelListed.indexOf(file) !== index) {
			problems.push(
				`scripts/hexagon-debt.txt: kernel ${file} is listed twice.`,
			);
		} else if (!impure.some((violation) => violation.file === file)) {
			problems.push(
				`scripts/hexagon-debt.txt: kernel ${file} ${existsSync(join(root, file)) ? "is pure now" : "is not a file"}. Remove it.`,
			);
		}
	}

	for (const slice of slices) {
		const key = keyOf(slice);
		if (mechanisms.has(key)) continue;
		const own = [
			...shapeProblems(root, slice),
			...withSubs(slice).flatMap((part) => [
				...wireProblems(root, part),
				...useCaseProblems(root, part),
				...portProblems(root, part),
			]),
			...violations.filter((v) => v.vertical === key).map((v) => v.message),
		];
		if (!listed.includes(key)) problems.push(...own);
		else if (!own.length && hasApplication(slice)) {
			problems.push(`scripts/hexagon-debt.txt: ${key} is in shape. Remove it.`);
		}
	}

	const verticals = new Set(slices.map(keyOf));
	for (const [index, line] of listed.entries()) {
		if (listed.indexOf(line) !== index) {
			problems.push(`scripts/hexagon-debt.txt: ${line} is listed twice.`);
		} else if (!verticals.has(line)) {
			problems.push(
				`scripts/hexagon-debt.txt: ${line} is not a vertical of a server package. Remove it.`,
			);
		} else if (mechanisms.has(line)) {
			problems.push(
				`scripts/hexagon-debt.txt: ${line} is a mechanism (scripts/capabilities.ts). The ring rules do not cover it. Remove it.`,
			);
		}
	}

	return problems;
}

/**
 * The mechanisms of the server packages on a capability map (`VERTICALS` of
 * `scripts/capabilities.ts`), each as `<package>/<vertical>`.
 */
export function mechanismsOf(
	map: Record<string, Record<string, string>> = VERTICALS,
): string[] {
	return SERVER_PACKAGES.flatMap((pkg) =>
		Object.entries(map[`packages/${pkg}`] ?? {})
			.filter(([, place]) => place === MECHANISM)
			.map(([vertical]) => `${pkg}/${vertical}`),
	);
}

if (import.meta.main) {
	const started = performance.now();
	const root = join(import.meta.dir, "..");
	const debt = readFileSync(join(import.meta.dir, "hexagon-debt.txt"), "utf8");
	const mechanisms = mechanismsOf();
	const problems = [
		...biomeProblems(readFileSync(join(root, "biome.json"), "utf8")),
		...(await checkRings(root, { debt, mechanisms })),
	];
	if (problems.length) {
		console.error("Ring check failed (scripts/check-rings.ts):\n");
		for (const problem of problems) console.error(`- ${problem}`);
		console.error(
			"\nA vertical that is not in shape yet is on scripts/hexagon-debt.txt. That list only gets shorter: a new slice starts in shape.",
		);
		process.exit(1);
	}
	const ms = Math.round(performance.now() - started);
	const verticals = slicesOf(root).length;
	const waiting = debtOf(debt).filter((line) => !KERNEL_LINE.test(line)).length;
	console.log(
		`Ring check passed: ${verticals} verticals of the server packages, ${verticals - waiting - mechanisms.length} in shape, ${waiting} on the debt list, ${mechanisms.length} mechanisms (${ms} ms).`,
	);
}
