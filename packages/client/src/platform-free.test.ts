/**
 * The package runs in a browser, in React Native and in Bun's tests, so its
 * source may use none of their own APIs. This test reads every source file
 * (tests excluded) and fails on an import or a global that only one
 * platform has, and on any package outside the short list below.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/** The packages the source may import, and whether only `import type` may. */
const ALLOWED: Record<string, "types" | "values"> = {
	"@nightshift/api/client": "types",
	"@nightshift/flows": "values",
	"@orpc/client": "values",
	"@orpc/client/fetch": "values",
	"@orpc/tanstack-query": "values",
	"@tanstack/react-query": "values",
	react: "values",
};

/** Globals of one platform: the DOM, Node, Bun, Deno. */
const PLATFORM_GLOBALS = new Set([
	"window",
	"document",
	"navigator",
	"location",
	"localStorage",
	"sessionStorage",
	"Notification",
	"HTMLElement",
	"process",
	"Buffer",
	"require",
	"__dirname",
	"__filename",
	"Bun",
	"Deno",
]);

/** What in `source` breaks the rules, one line per problem. */
function violations(file: string, source: string): string[] {
	const found: string[] = [];
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const where = (node: ts.Node) =>
		`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

	const checkSpecifier = (
		node: ts.Node,
		specifier: string,
		typeOnly: boolean,
	) => {
		if (specifier.startsWith("./") || specifier.startsWith("../")) return;
		const allowed = ALLOWED[specifier];
		if (!allowed) {
			found.push(`${where(node)} imports "${specifier}"`);
		} else if (allowed === "types" && !typeOnly) {
			found.push(`${where(node)} imports "${specifier}" without "import type"`);
		}
	};

	const visit = (node: ts.Node) => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			const clause = node.importClause;
			const typeOnly =
				clause !== undefined &&
				(clause.isTypeOnly ||
					(clause.name === undefined &&
						clause.namedBindings !== undefined &&
						ts.isNamedImports(clause.namedBindings) &&
						clause.namedBindings.elements.length > 0 &&
						clause.namedBindings.elements.every((e) => e.isTypeOnly)));
			checkSpecifier(node, node.moduleSpecifier.text, typeOnly);
		} else if (
			ts.isExportDeclaration(node) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			checkSpecifier(node, node.moduleSpecifier.text, node.isTypeOnly);
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			const [arg] = node.arguments;
			if (arg && ts.isStringLiteral(arg)) checkSpecifier(node, arg.text, false);
			else found.push(`${where(node)} imports a computed path`);
		} else if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		) {
			checkSpecifier(node, node.argument.literal.text, true);
		} else if (ts.isIdentifier(node) && PLATFORM_GLOBALS.has(node.text)) {
			const parent = node.parent;
			const isMemberName =
				(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
				(ts.isPropertyAssignment(parent) && parent.name === node) ||
				(ts.isPropertySignature(parent) && parent.name === node) ||
				(ts.isPropertyDeclaration(parent) && parent.name === node) ||
				(ts.isMethodDeclaration(parent) && parent.name === node) ||
				(ts.isMethodSignature(parent) && parent.name === node);
			if (!isMemberName) found.push(`${where(node)} uses "${node.text}"`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...sourceFiles(path));
		else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

describe("the client package", () => {
	test("uses no API of one platform, and imports only what it may", () => {
		const src = import.meta.dir;
		const files = sourceFiles(src);
		expect(files.length).toBeGreaterThan(10);
		const found = files.flatMap((file) =>
			violations(relative(src, file), readFileSync(file, "utf8")),
		);
		expect(found).toEqual([]);
	});
});

describe("the check itself", () => {
	test("fails on Node, Bun, the DOM and React Native", () => {
		const source = [
			'import { readFileSync } from "node:fs";',
			'import { Database } from "bun:sqlite";',
			'import { View } from "react-native";',
			'import * as SecureStore from "expo-secure-store";',
			'import { appRouter } from "@nightshift/api";',
			'import { loadFlow } from "@nightshift/flows/files";',
			'import { AppRouterClient } from "@nightshift/api/client";',
			'export { x } from "@nightshift/engine";',
			'const m = await import("node:path");',
			"const width = window.innerWidth;",
			"const env = process.env.HOME;",
			"Bun.sleep(1);",
		].join("\n");
		expect(violations("bad.ts", source)).toEqual([
			'bad.ts:1 imports "node:fs"',
			'bad.ts:2 imports "bun:sqlite"',
			'bad.ts:3 imports "react-native"',
			'bad.ts:4 imports "expo-secure-store"',
			'bad.ts:5 imports "@nightshift/api"',
			'bad.ts:6 imports "@nightshift/flows/files"',
			'bad.ts:7 imports "@nightshift/api/client" without "import type"',
			'bad.ts:8 imports "@nightshift/engine"',
			'bad.ts:9 imports "node:path"',
			'bad.ts:10 uses "window"',
			'bad.ts:11 uses "process"',
			'bad.ts:12 uses "Bun"',
		]);
	});

	test("lets through types of the API, the flows root, and member names", () => {
		const source = [
			'import type { AppRouterClient } from "@nightshift/api/client";',
			'import { type AppRouter } from "@nightshift/api/client";',
			'import { checkDraft } from "@nightshift/flows";',
			'import { useQuery } from "@tanstack/react-query";',
			'import { RPCLink } from "@orpc/client/fetch";',
			'import { gateKey } from "./rules";',
			"const a = { document: 1, location: 2 };",
			"const b = options.window;",
			"type C = { process: string };",
		].join("\n");
		expect(violations("good.ts", source)).toEqual([]);
	});
});
