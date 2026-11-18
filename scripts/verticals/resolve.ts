/**
 * Where an import of a workspace points: the path aliases of its
 * `tsconfig.json`, the file that a specifier names, and the entries that
 * its `package.json` exports.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import ts from "@typescript/typescript6";

/** `"@/*": ["./src/*"]` style aliases of the workspace tsconfig. */
export function aliases(
	workspace: string,
): { prefix: string; target: string }[] {
	const file = join(workspace, "tsconfig.json");
	if (!existsSync(file)) return [];
	const { config } = ts.parseConfigFileTextToJson(
		file,
		readFileSync(file, "utf8"),
	);
	const options = config?.compilerOptions ?? {};
	const base = resolve(workspace, options.baseUrl ?? ".");
	const found: { prefix: string; target: string }[] = [];
	for (const [key, targets] of Object.entries(
		(options.paths ?? {}) as Record<string, string[]>,
	)) {
		const target = targets[0];
		if (!key.endsWith("/*") || !target?.endsWith("/*")) continue;
		found.push({
			prefix: key.slice(0, -1),
			target: resolve(base, target.slice(0, -2)),
		});
	}
	return found;
}

export function resolveFile(base: string): string | undefined {
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	];
	if (/\.jsx?$/.test(base))
		candidates.push(
			base.replace(/\.jsx?$/, ".ts"),
			base.replace(/\.jsx?$/, ".tsx"),
		);
	return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

/**
 * The file that a relative or aliased import of the workspace names, or
 * nothing for a package import.
 */
export function resolverFor(
	wsDir: string,
): (from: string, specifier: string) => string | undefined {
	const pathAliases = aliases(wsDir);
	return (from, specifier) => {
		if (specifier.startsWith(".")) {
			return resolveFile(resolve(dirname(from), specifier));
		}
		for (const alias of pathAliases) {
			if (specifier.startsWith(alias.prefix)) {
				return resolveFile(
					join(alias.target, specifier.slice(alias.prefix.length)),
				);
			}
		}
		return undefined;
	};
}

/** The workspace's `package.json`, or nothing. */
export function packageJson(workspace: string): {
	name?: string;
	exports?: unknown;
} {
	const file = join(workspace, "package.json");
	return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/** The files that the workspace's `package.json` `exports` names. */
export function entryFiles(workspace: string): Set<string> {
	const targets: string[] = [];
	const collect = (value: unknown): void => {
		if (typeof value === "string") targets.push(value);
		else if (value && typeof value === "object")
			for (const inner of Object.values(value)) collect(inner);
	};
	collect(packageJson(workspace).exports);
	return new Set(
		targets
			.filter((target) => !target.includes("*"))
			.map((target) => resolve(workspace, target)),
	);
}
