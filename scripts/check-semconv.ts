/**
 * Fails when a TypeScript file outside `@nightshift/semconv` and the Weaver
 * registry contains a telemetry name as a string literal. A telemetry name
 * is `gen_ai.` or `nightshift.` plus one or more segments (`nightshift.run.id`,
 * `nightshift.step`). The names live in the generated constants. A comment
 * is not a string literal. `@nightshift/telemetry` and `nightshift` alone
 * do not match: the prefix needs a dotted segment after it.
 *
 * A file name, an email, a host, a bundle id and an app storage key use the
 * same prefix and are not telemetry names. Their first segment is listed in
 * `PRODUCT`. A hyphenated key (`nightshift.host-address`) does not match.
 *
 *   bun scripts/check-semconv.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const SKIP_DIR = new Set([
	"node_modules",
	"dist",
	".git",
	".turbo",
	"coverage",
	".claude",
]);

const GEN_AI = ["gen", "ai"].join("_");
const NIGHTSHIFT = ["night", "shift"].join("");

/**
 * A telemetry name: the prefix, then dotted segments of letters, digits and
 * underscores. Built so this file has no such literal. A hyphen ends the
 * match, so an app storage key with a hyphen does not match.
 */
const NAME = new RegExp(
	`(?<![A-Za-z0-9_])(?:${GEN_AI}|${NIGHTSHIFT})(?:\\.[a-z][a-z0-9_]*)+(?![A-Za-z0-9_-])`,
	"g",
);

/**
 * First segments that name a file, an email, a host, a bundle id or an app
 * storage key. They are not telemetry names.
 */
const PRODUCT = new Set([
	"appearance",
	"assistant",
	"db",
	"desktop",
	"example",
	"glance",
	"invalid",
	"json",
	"notifications",
	"service",
	"space",
	"sqlite",
	"ts",
	"tsx",
]);

/** Whether `text` contains a telemetry name written by hand. */
function banned(text: string): boolean {
	const hits = text.match(NAME);
	if (!hits) return false;
	return hits.some((token) => {
		const namespace = token.slice(0, token.indexOf("."));
		if (namespace === GEN_AI) return true;
		const segment = token.split(".")[1] ?? "";
		return !PRODUCT.has(segment);
	});
}

/** What in `source` is a banned semantic-convention string. */
export function semconvProblems(source: string, file: string): string[] {
	const found: string[] = [];
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const where = (node: ts.Node) =>
		`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
	const report = (node: ts.Node, text: string) => {
		if (!banned(text)) return;
		found.push(
			`${where(node)} has a semantic-convention string. Import it from @nightshift/semconv.`,
		);
	};
	const visit = (node: ts.Node) => {
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			report(node, node.text);
		} else if (
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		) {
			report(node, node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

function skipped(root: string, path: string): boolean {
	const rel = relative(root, path).split("\\").join("/");
	return (
		rel === "apps/desktop/.hutch" ||
		rel === "apps/desktop/build" ||
		rel.startsWith("packages/semconv/") ||
		rel.startsWith("packages/telemetry/registry/")
	);
}

/** TypeScript files under `root`, except the generated package and the registry. */
export function sourceFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (SKIP_DIR.has(entry.name)) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (skipped(root, path)) continue;
				walk(path);
				continue;
			}
			if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
			if (skipped(root, path)) continue;
			files.push(relative(root, path).split("\\").join("/"));
		}
	};
	walk(root);
	return files;
}

/** Problems in `root`. A banned string outside the generated package fails. */
export function checkSemconv(root: string): string[] {
	const problems: string[] = [];
	for (const file of sourceFiles(root)) {
		const source = readFileSync(join(root, file), "utf8");
		problems.push(...semconvProblems(source, file));
	}
	return problems;
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const problems = checkSemconv(root);
	if (problems.length > 0) {
		console.error(
			"Semantic convention check failed (docs/steering/STRUCTURE.md, section 7):\n",
		);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	console.log("Semantic convention check passed.");
}
