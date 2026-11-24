/**
 * The file rules of a slice: its `wire.ts`, one use case per file with its
 * test (H6), and an in-memory adapter and one contract suite for every
 * port (H7). `scripts/check-rings.ts` writes the naming conventions out.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import ts from "@typescript/typescript6";

import { resolveFile } from "../verticals/resolve";
import { parse } from "../verticals/source-file";
import { readPorts } from "./decides";
import type { Slice } from "./slices";
import { camel, exportedFunctions, treeOf } from "./syntax";

/** `ScheduleStore` is `schedule-store`, `HTTPClient` is `http-client`. */
export const kebab = (name: string): string =>
	name
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase();

/** `run-status` is `RunStatus`. */
const pascal = (name: string): string =>
	camel(name).replace(/^[a-z]/, (letter) => letter.toUpperCase());

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Who fills a port from outside: `devices`, `engine/run`, or `engine/wire`. */
const FILLER = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

/**
 * `<package>/wire` names the composition of a package: its `src/wire.ts`,
 * which builds the port from several things.
 */
const COMPOSITION = "wire";

/** `filledBy` names a package, a top-level vertical of one, or the composition of one. */
function fillerExists(
	root: string,
	filledBy: string,
	map: Record<string, Record<string, string>>,
): boolean {
	const parts = filledBy.split("/");
	const pkg = parts[0];
	const rest = parts.slice(1).join("/");
	const workspace = `packages/${pkg}`;
	const src = join(root, "packages", pkg ?? "", "src");
	if (rest === COMPOSITION && existsSync(join(src, "wire.ts"))) return true;
	if (!rest) return existsSync(src);
	const top = rest.split("/")[0] ?? "";
	if (rest !== top) return false;
	if (!(top in (map[workspace] ?? {}))) return false;
	return existsSync(join(src, top));
}

const list = (names: Iterable<string>) =>
	[...names]
		.sort()
		.map((name) => `"${name}"`)
		.join(", ");

/** Each in-memory adapter of `files`, with the files that import it. */
export function twinReadersOf(files: Iterable<string>): Map<string, string[]> {
	const readers = new Map<string, string[]>();
	for (const file of files) {
		// A parse of every file costs a second: few name a twin.
		if (!readFileSync(file, "utf8").includes("/in-memory-")) continue;
		for (const { specifier } of parse(file).imports) {
			if (!/^\..*\/in-memory-[^/]*$/.test(specifier)) continue;
			const twin = resolveFile(resolve(dirname(file), specifier));
			if (twin) readers.set(twin, [...(readers.get(twin) ?? []), file]);
		}
	}
	return readers;
}

/** The `.ts` files directly in `dir`, in name order. */
function tsFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => entry.name)
		.sort();
}

/** `from` imports `name` (or every name) of the file `target`. */
function importsFrom(from: string, target: string, name?: string): boolean {
	return parse(from).imports.some((imported) => {
		if (!imported.specifier.startsWith(".")) return false;
		const file = resolveFile(resolve(dirname(from), imported.specifier));
		if (file !== target) return false;
		return !name || imported.names === "all" || imported.names.includes(name);
	});
}

/**
 * H6: what breaks "one use case per file, with its test" in the
 * `application/` of one slice (not of its sub-verticals), as messages.
 */
export function useCaseProblems(root: string, slice: Slice): string[] {
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const dir = join(slice.dir, "application");
	const files = tsFiles(dir);
	const names = new Set(files);
	const problems: string[] = [];
	for (const name of files) {
		const path = join(dir, name);
		if (name === "ports.ts") {
			const { values } = parse(path);
			if (values.size) {
				problems.push(
					`${rel(path)}: ports.ts holds types only, but it exports the value${values.size === 1 ? "" : "s"} ${list(values)}. Move ${values.size === 1 ? "it" : "them"} to a use case file or to domain/.`,
				);
			}
			continue;
		}
		if (name.endsWith(".test.ts")) {
			const base = name.slice(0, -".test.ts".length);
			if (base === "ports" || !names.has(`${base}.ts`)) {
				problems.push(
					`${rel(path)}: tests no use case. application/ has one test per use case, with its name: there is no ${base === "ports" ? "use case in ports.ts" : `${base}.ts`}.`,
				);
			}
			continue;
		}
		const base = name.slice(0, -".ts".length);
		if (!KEBAB.test(base)) {
			problems.push(
				`${rel(path)}: name a use case file <verb>-<object>.ts in lower case (answer-gate.ts).`,
			);
			continue;
		}
		const { values, exports } = parse(path);
		const expected = camel(base);
		const one =
			values.size === 1 &&
			values.has(expected) &&
			exportedFunctions(path).has(expected) &&
			!exports.stars.length;
		if (!one) {
			problems.push(
				`${rel(path)}: a use case file exports one function, named for the file ("${expected}"), and types. It exports ${values.size ? `the value${values.size === 1 ? "" : "s"} ${list(values)}` : "no value"}${values.size === 1 && values.has(expected) ? ", which is not written as a function" : ""}.`,
			);
		}
		if (!names.has(`${base}.test.ts`)) {
			problems.push(
				`${rel(path)}: has no test. Add ${base}.test.ts beside it.`,
			);
		}
	}
	return problems;
}

/**
 * What is wrong with the `wire.ts` of one slice (not of its sub-verticals),
 * as messages. A slice with use cases has one. It exports one function,
 * `wire<Slice>`, and types.
 */
export function wireProblems(root: string, slice: Slice): string[] {
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const wire = join(slice.dir, "wire.ts");
	const expected = `wire${pascal(basename(slice.dir))}`;
	if (!existsSync(wire)) {
		if (!existsSync(join(slice.dir, "application"))) return [];
		return [
			`${rel(slice.dir)}/: has use cases and no wire.ts. Add wire.ts, which exports the function "${expected}": it builds the real adapters and returns the use cases bound to their ports.`,
		];
	}
	const { values, exports } = parse(wire);
	if (
		values.size === 1 &&
		values.has(expected) &&
		exportedFunctions(wire).has(expected) &&
		!exports.stars.length
	)
		return [];
	return [
		`${rel(wire)}: a wire.ts exports one function, named for the slice ("${expected}"), and types. It exports ${values.size ? `the value${values.size === 1 ? "" : "s"} ${list(values)}` : "no value"}${values.size === 1 && values.has(expected) ? ", which is not written as a function" : ""}.`,
	];
}

export type Port = {
	name: string;
	/**
	 * Who implements it, when that is another slice or another package:
	 * the word after `@filledBy` in the comment of the type.
	 */
	filledBy?: string;
};

/**
 * The ports of a slice: the types its `application/ports.ts` exports, each
 * with its `@filledBy` tag.
 */
export function portsOf(slice: Slice): Port[] {
	const path = join(slice.dir, "application", "ports.ts");
	if (!existsSync(path)) return [];
	const source = treeOf(path);
	const fillers = new Map<string, string>();
	for (const statement of source.statements) {
		if (
			!ts.isTypeAliasDeclaration(statement) &&
			!ts.isInterfaceDeclaration(statement)
		)
			continue;
		for (const tag of ts.getJSDocTags(statement)) {
			if (tag.tagName.text !== "filledBy") continue;
			const words = (ts.getTextOfJSDocComment(tag.comment) ?? "").trim();
			// The name ends at a space or at punctuation: "@filledBy auth: why".
			fillers.set(statement.name.text, /^[^\s:;,.]*/.exec(words)?.[0] ?? "");
		}
	}
	const { exports, values } = parse(path);
	return [...new Set(exports.names)]
		.filter((name) => !values.has(name) && name !== "default")
		.sort()
		.map((name) => ({ name, filledBy: fillers.get(name) }));
}

/**
 * H7: what each port of one slice (not of its sub-verticals) lacks, as
 * messages. A port has its real adapter, its contract suite and the test
 * that runs the suite. It has its in-memory adapter when something reads
 * it, and the suite runs on both then. A port with `@filledBy` has an
 * in-memory adapter only. `twinReaders` gives the files that import a twin.
 */
export function portProblems(
	root: string,
	slice: Slice,
	map: Record<string, Record<string, string>>,
	twinReaders: Map<string, string[]>,
): string[] {
	const rel = (path: string) => relative(root, path).split(sep).join("/");
	const read = readPorts(slice);
	const ports = join(slice.dir, "application", "ports.ts");
	const out = join(slice.dir, "adapters", "out");
	const files = tsFiles(out);
	const problems: string[] = [];
	for (const { name: port, filledBy } of portsOf(slice)) {
		const name = kebab(port);
		const where = `${rel(ports)}: the port ${port}`;
		const real = new RegExp(
			`^(?!in-memory-)[a-z0-9]+(?:-[a-z0-9]+)*-${name}\\.ts$`,
		);
		const reals = files.filter((file) => real.test(file));

		if (filledBy !== undefined) {
			if (!FILLER.test(filledBy) || !fillerExists(root, filledBy, map)) {
				problems.push(
					`${where} has @filledBy ${filledBy ? `"${filledBy}", which is no package and no vertical of one` : "without a name"}. Write who implements it: a package (@filledBy devices), a vertical (@filledBy engine/runs), or the wire.ts of a package that builds it from several things (@filledBy engine/wire).`,
				);
			} else if (filledBy === `${slice.pkg}/${slice.path}`) {
				problems.push(
					`${where} has @filledBy "${filledBy}", its own slice. Remove the tag, and give the port its real adapter and its contract suite.`,
				);
			}
			if (reals.length) {
				problems.push(
					`${where} has @filledBy, but its real adapter is here (adapters/out/${reals[0]}). Remove the tag, and give the port its contract suite.`,
				);
			}
			const twins = files.filter(
				(file) =>
					file.startsWith("in-memory-") &&
					importsFrom(join(out, file), ports, port),
			);
			if (!twins.length) {
				problems.push(
					`${where} (filled by ${filledBy || "another slice"}) has no in-memory adapter. Write one in a file adapters/out/in-memory-*.ts that imports ${port} from application/ports.ts. One file may hold the in-memory adapters of several such ports.`,
				);
			}
			continue;
		}

		const twin = join(out, `in-memory-${name}.ts`);
		const test = join(out, `${name}.contract.test.ts`);
		const twinned = existsSync(twin);
		const wantsTwin = read.has(port);
		if (!twinned && wantsTwin) {
			problems.push(
				`${where} is read by a use case and has no in-memory adapter. Add adapters/out/in-memory-${name}.ts. If another slice or package implements the port, write @filledBy <who> in its comment.`,
			);
		} else if (
			twinned &&
			!wantsTwin &&
			(twinReaders.get(twin) ?? []).every((reader) => reader === test)
		) {
			problems.push(
				`${rel(twin)}: no use case reads ${port}, and nothing but its contract test imports this in-memory adapter. Remove it: the suite runs on the real adapter alone.`,
			);
		} else if (twinned && !importsFrom(twin, ports, port)) {
			problems.push(
				`${rel(twin)}: does not import the port ${port} from application/ports.ts. An in-memory adapter is typed by its port.`,
			);
		}

		if (!reals.length) {
			problems.push(
				`${where} has no real adapter. Add adapters/out/<tech>-${name}.ts (drizzle-${name}.ts).`,
			);
		}

		const suite = join(out, `${name}.contract.ts`);
		const suiteName = `${camel(name)}Contract`;
		if (!existsSync(suite)) {
			problems.push(
				`${where} has no contract suite. Add adapters/out/${name}.contract.ts, which exports the function "${suiteName}".`,
			);
		} else {
			const { values } = parse(suite);
			if (
				values.size !== 1 ||
				!values.has(suiteName) ||
				!exportedFunctions(suite).has(suiteName)
			) {
				problems.push(
					`${rel(suite)}: a contract suite exports one function, "${suiteName}" here. It exports ${values.size ? list(values) : "no value"}.`,
				);
			}
			if (!importsFrom(suite, ports, port)) {
				problems.push(
					`${rel(suite)}: does not import the port ${port} from application/ports.ts. A contract suite is written against the port.`,
				);
			}
		}

		const both = twinned || wantsTwin;
		if (!existsSync(test)) {
			problems.push(
				`${where} has no test that runs its contract suite. Add adapters/out/${name}.contract.test.ts, which runs "${suiteName}" on ${both ? "the in-memory adapter and on the real one" : "the real adapter"}.`,
			);
			continue;
		}
		const lacks: string[] = [];
		if (!importsFrom(test, suite, suiteName))
			lacks.push(`"${suiteName}" from ./${name}.contract`);
		if (both && !importsFrom(test, twin)) lacks.push(`./in-memory-${name}`);
		if (!reals.some((file) => importsFrom(test, join(out, file))))
			lacks.push(
				`the real adapter (./${reals[0]?.slice(0, -3) ?? `<tech>-${name}`})`,
			);
		if (lacks.length) {
			problems.push(
				`${rel(test)}: runs the contract suite${both ? " on both adapters" : ""}, but it does not import ${lacks.join(" and ")}.`,
			);
		}
	}
	return problems;
}
