/**
 * The clock lives in `@nightshift/time`. This fails a call to `Date`,
 * `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` or date-fns anywhere
 * else. A type `Date` and `instanceof Date` stay: a library's `Date` is
 * a value to hand back, not a calendar.
 *
 * `scripts/time-debt.txt` lists the files that still call them. The check
 * fails a file that is not on the list, and fails a listed file once it
 * is clean. Remove the line in the change that moves the file.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const CALENDAR = new Set([
	"getFullYear",
	"getMonth",
	"getDate",
	"getDay",
	"getHours",
	"getMinutes",
	"getSeconds",
	"getMilliseconds",
	"getTimezoneOffset",
	"getUTCFullYear",
	"getUTCMonth",
	"getUTCDate",
	"getUTCDay",
	"getUTCHours",
	"getUTCMinutes",
	"getUTCSeconds",
	"getUTCMilliseconds",
	"setFullYear",
	"setMonth",
	"setDate",
	"setHours",
	"setMinutes",
	"setSeconds",
	"setMilliseconds",
	"setTime",
	"setUTCFullYear",
	"setUTCMonth",
	"setUTCDate",
	"setUTCHours",
	"setUTCMinutes",
	"setUTCSeconds",
	"setUTCMilliseconds",
	"toISOString",
	"toLocaleDateString",
	"toLocaleTimeString",
	"toDateString",
	"toTimeString",
	"toUTCString",
	"getTime",
]);

const DATE_STATICS = new Set(["now", "parse", "UTC"]);
const INTL_CLOCKS = new Set(["DateTimeFormat", "RelativeTimeFormat"]);

const SKIP_DIR = new Set([
	"node_modules",
	"dist",
	".git",
	".turbo",
	"coverage",
	".claude",
]);

/** What in `source` calls a clock outside `@nightshift/time`. */
export function timeProblems(source: string, file: string): string[] {
	const found: string[] = [];
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const where = (node: ts.Node) =>
		`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
	const report = (node: ts.Node, call: string) => {
		found.push(`${where(node)} calls \`${call}\`. Use @nightshift/time.`);
	};

	const visit = (node: ts.Node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const spec = node.moduleSpecifier;
			if (spec && ts.isStringLiteral(spec) && bannedModule(spec.text)) {
				report(node, `import "${spec.text}"`);
			}
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			const [arg] = node.arguments;
			if (arg && ts.isStringLiteral(arg) && bannedModule(arg.text)) {
				report(node, `import("${arg.text}")`);
			}
		} else if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "Date"
		) {
			report(node, "new Date");
		} else if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression)
		) {
			if (node.expression.text === "Date" && DATE_STATICS.has(node.name.text)) {
				report(node, `Date.${node.name.text}`);
			} else if (
				node.expression.text === "Intl" &&
				INTL_CLOCKS.has(node.name.text)
			) {
				report(node, `Intl.${node.name.text}`);
			}
		} else if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			(CALENDAR.has(node.expression.name.text) || isClockLocaleString(node)) &&
			!isRecordManagerClock(node)
		) {
			report(node, `.${node.expression.name.text}()`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

const LOCALE_CLOCK = new Set([
	"dateStyle",
	"timeStyle",
	"weekday",
	"era",
	"hour",
	"minute",
	"second",
	"day",
	"month",
	"year",
	"timeZone",
	"hourCycle",
	"dayPeriod",
]);

/**
 * `toLocaleString` on a number groups digits. It is a clock only when the
 * receiver is built here (`new Date()`, a call) or the options name a date.
 */
function isClockLocaleString(node: ts.CallExpression): boolean {
	if (!ts.isPropertyAccessExpression(node.expression)) return false;
	if (node.expression.name.text !== "toLocaleString") return false;
	const receiver = node.expression.expression;
	if (ts.isNewExpression(receiver) || ts.isCallExpression(receiver))
		return true;
	return node.arguments.some(
		(arg) =>
			ts.isObjectLiteralExpression(arg) &&
			arg.properties.some(
				(prop) =>
					ts.isPropertyAssignment(prop) &&
					ts.isIdentifier(prop.name) &&
					LOCALE_CLOCK.has(prop.name.text),
			),
	);
}

/**
 * `@langchain` `RecordManager.getTime` returns a promise. `Date#getTime`
 * does not, so an awaited call is that method, not the clock.
 */
function isRecordManagerClock(node: ts.CallExpression): boolean {
	return (
		ts.isPropertyAccessExpression(node.expression) &&
		node.expression.name.text === "getTime" &&
		ts.isAwaitExpression(node.parent)
	);
}

function bannedModule(specifier: string): boolean {
	return (
		specifier === "date-fns" ||
		specifier.startsWith("date-fns/") ||
		specifier === "@date-fns/tz" ||
		specifier.startsWith("@date-fns/tz/") ||
		specifier === "@date-fns/utc" ||
		specifier.startsWith("@date-fns/utc/")
	);
}

/** Source files under `root`, except the time package, installs and generated files. */
export function sourceFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (SKIP_DIR.has(entry.name)) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				const rel = relative(root, path).split("\\").join("/");
				if (rel === "apps/desktop/.hutch" || rel === "apps/desktop/build") {
					continue;
				}
				walk(path);
				continue;
			}
			if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
			if (entry.name.endsWith(".gen.ts") || entry.name === "env.ts") continue;
			const rel = relative(root, path).split("\\").join("/");
			if (rel.startsWith("packages/time/")) continue;
			files.push(rel);
		}
	};
	walk(root);
	return files;
}

/** The debt list: one repo-relative path per line. `#` starts a comment. */
export function debtOf(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.replace(/#.*/, "").trim())
		.filter((line) => line.length > 0);
}

/**
 * Problems in `root`. `debt` is the text of the allow-list. A listed file
 * that is clean, or missing, is a problem. A file that is not listed and
 * calls a clock is a problem.
 */
export function checkTime(root: string, debt: string): string[] {
	const listed = debtOf(debt);
	const dirty = new Set<string>();
	const problems: string[] = [];
	for (const file of sourceFiles(root)) {
		const source = readFileSync(join(root, file), "utf8");
		const found = timeProblems(source, file);
		if (found.length > 0) dirty.add(file);
		if (!listed.includes(file)) problems.push(...found);
	}
	for (const file of listed) {
		const full = join(root, file);
		let exists = false;
		try {
			exists = statSync(full).isFile();
		} catch {
			exists = false;
		}
		if (!exists) {
			problems.push(`scripts/time-debt.txt: ${file} is not a file. Remove it.`);
		} else if (!dirty.has(file)) {
			problems.push(`scripts/time-debt.txt: ${file} is clean. Remove it.`);
		}
	}
	return problems;
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const debt = readFileSync(join(import.meta.dir, "time-debt.txt"), "utf8");
	const problems = checkTime(root, debt);
	if (problems.length > 0) {
		console.error(
			"Time check failed (docs/steering/STRUCTURE.md, section 7):\n",
		);
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	console.log("Time check passed.");
}
