/**
 * The import rules of the rings (H1, H2, H3, H5): dependency-cruiser runs
 * the rules of `.dependency-cruiser.mjs` on the server packages, and this
 * module says which vertical each broken rule belongs to. It adds the one
 * rule that needs the capability map: what `application/` may import of a
 * mechanism.
 */

import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import {
	cruise,
	type ICruiseResult,
	type IForbiddenRuleType,
	type IViolation,
} from "dependency-cruiser";

import ringRules, {
	PACKAGE_KERNEL,
	SERVER_PACKAGES,
} from "../../.dependency-cruiser.mjs";
import { aliases } from "../verticals/resolve";

export type RingViolation = {
	/** The rule's name in `.dependency-cruiser.mjs`: `h1-domain`. */
	rule: string;
	/** `<package>/<vertical>`: the vertical whose ring the import breaks. */
	vertical: string;
	/** The file that imports, from the repository root. */
	file: string;
	message: string;
};

/** The rule that keeps the kernel of a package pure. */
export const KERNEL_RULE = "kernel-outside-world";

const MECHANISM_VALUE = "h2-mechanism-value";

/** `packages/engine/src/schedules/domain/next.ts` is `engine/schedules`. */
function verticalOf(path: string): string | undefined {
	const match = /^packages\/([^/]+)\/src\/([^/]+)\//.exec(path);
	return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * One rule per package: `application/` imports only types from a mechanism
 * that is not kernel. `mechanisms` are `<package>/<vertical>`.
 */
function mechanismRules(mechanisms: Iterable<string>): IForbiddenRuleType[] {
	const byPackage = new Map<string, string[]>();
	for (const mechanism of mechanisms) {
		const [pkg, vertical] = mechanism.split("/") as [string, string];
		if (PACKAGE_KERNEL[pkg]?.includes(vertical)) continue;
		byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), vertical]);
	}
	return [...byPackage].map(([pkg, verticals]) => ({
		name: `${MECHANISM_VALUE}-${pkg}`,
		severity: "error",
		comment:
			"application/ imports only types from a mechanism that is not kernel (import type). What a mechanism does comes in through a port (H2).",
		from: { path: `^packages/${pkg}/src/(.+?)/application/` },
		to: {
			path: `^packages/${pkg}/src/(?:${verticals.join("|")})/`,
			dependencyTypesNot: ["type-only"],
		},
	}));
}

/**
 * The imports under `root` (the repository root) that break a ring rule,
 * in the order of the files. A broken H5 belongs to the vertical of the
 * adapter. Every other rule belongs to the vertical of the importing file.
 * `mechanisms` are the mechanisms of the capability map, each as
 * `<package>/<vertical>`. `problems` are what keeps the rules from reading
 * a package.
 */
export async function importViolations(
	root: string,
	mechanisms: Iterable<string> = [],
): Promise<{ violations: RingViolation[]; problems: string[] }> {
	// dependency-cruiser names a file by its real path.
	const base = realpathSync(root);
	const problems: string[] = [];
	const sources: string[] = [];
	for (const pkg of SERVER_PACKAGES) {
		const workspace = join(base, "packages", pkg);
		if (!existsSync(join(workspace, "src"))) continue;
		sources.push(`packages/${pkg}/src`);
		// The rules do not read tsconfig paths: that needs the compiler API,
		// which TypeScript 7.0 does not have.
		if (aliases(workspace).length) {
			problems.push(
				`packages/${pkg}/tsconfig.json: a server package has no path aliases. The ring check does not read them. Use relative imports, or add the alias to enhancedResolveOptions in .dependency-cruiser.mjs.`,
			);
		}
	}
	if (!sources.length) return { violations: [], problems };

	const forbidden = [
		...(ringRules.forbidden ?? []),
		...mechanismRules(mechanisms),
	];
	const result = await cruise(sources, {
		...ringRules.options,
		baseDir: base,
		ruleSet: { forbidden },
		validate: true,
	});
	const { summary } = result.output as ICruiseResult;

	const words = new Map(
		forbidden.map((rule) => [rule.name, rule.comment ?? ""]),
	);
	const key = (v: IViolation) => `${v.from}\0${v.to}`;
	// An import that breaks H3 breaks H1 or H2 as well. H3 says more.
	const outside = new Set(
		summary.violations
			.filter((v) => v.rule.name === "h3-outside-world")
			.map(key),
	);
	const violations: RingViolation[] = [];
	for (const violation of summary.violations) {
		const rule = violation.rule.name;
		if (!words.has(rule)) continue;
		if (rule !== "h3-outside-world" && outside.has(key(violation))) continue;
		const vertical = verticalOf(
			rule.startsWith("h5-") ? violation.to : violation.from,
		);
		if (!vertical) continue;
		const imported = violation.unresolvedTo ?? violation.to;
		const target =
			violation.to === imported || !violation.to.startsWith("packages/")
				? ""
				: ` (${violation.to})`;
		violations.push({
			rule,
			vertical,
			file: violation.from,
			message: `${violation.from}: imports "${imported}"${target}. ${words.get(rule)}`,
		});
	}
	violations.sort((a, b) =>
		a.message < b.message ? -1 : a.message > b.message ? 1 : 0,
	);
	return { violations, problems };
}
