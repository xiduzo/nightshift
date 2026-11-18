/**
 * A type written as `import("x").Name`, where a ring rule applies.
 *
 * dependency-cruiser reads the files with swc (see `.dependency-cruiser.mjs`),
 * and swc does not report that form inside a type declaration. So the form
 * itself fails:
 * - in `domain/`, `application/` and `adapters/in/` of a server package
 * - in a kernel mechanism of a package (PACKAGE_KERNEL), tests apart
 * - anywhere in a server package but a test, when it names a file in an
 *   `adapters/out/` folder
 * Write an `import type` statement there: the ring rules read it.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "@typescript/typescript6";

import { PACKAGE_KERNEL, SERVER_PACKAGES } from "../../.dependency-cruiser.mjs";
import { isTest } from "../check-layers";
import { resolveFile } from "../verticals/resolve";
import { walk } from "../verticals/source-file";
import { KERNEL_RULE, type RingViolation } from "./imports";

const IN_RING = /\/src\/.+?\/(?:domain|application|adapters\/in)\//;
const IN_ADAPTERS_OUT = /\/src\/.+\/adapters\/out\//;

/** The specifiers of the `import("x")` types in `text`. */
function importTypes(path: string, text: string): string[] {
	if (!text.includes("import(")) return [];
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		)
			found.push(node.argument.literal.text);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/**
 * The `import("x")` types under `root` (the repository root) that a ring
 * rule cannot read. One in a ring belongs to the vertical of its file. One
 * that names a file of `adapters/out/` belongs to the vertical of that file.
 * One in a kernel mechanism has the kernel's rule.
 */
export function importTypeViolations(root: string): RingViolation[] {
	const violations: RingViolation[] = [];
	for (const pkg of SERVER_PACKAGES) {
		const src = join(root, "packages", pkg, "src");
		if (!existsSync(src)) continue;
		const files: string[] = [];
		walk(src, files);
		const verticalOf = (path: string) =>
			`${pkg}/${relative(src, path).split(sep)[0]}`;
		const kernel = PACKAGE_KERNEL[pkg] ?? [];
		for (const path of files) {
			const file = relative(root, path).split(sep).join("/");
			const test = isTest(relative(src, path));
			const inKernel =
				!test && kernel.includes(relative(src, path).split(sep)[0] as string);
			for (const specifier of importTypes(path, readFileSync(path, "utf8"))) {
				const target = specifier.startsWith(".")
					? resolveFile(resolve(dirname(path), specifier))
					: undefined;
				const adapter =
					target && IN_ADAPTERS_OUT.test(target.split(sep).join("/")) && !test;
				if (!IN_RING.test(`/${file}`) && !adapter && !inKernel) continue;
				violations.push({
					rule: inKernel ? KERNEL_RULE : "import-type",
					vertical: verticalOf(adapter && target ? target : path),
					file,
					message: `${file}: writes a type as import("${specifier}"). Write an "import type" statement: the ring rules read it.`,
				});
			}
		}
	}
	return violations;
}
