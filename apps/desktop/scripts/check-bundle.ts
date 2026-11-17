/**
 * Checks the main-process bundle in each built app archive
 * (`artifacts/*.tar.zst`) before the release workflow uploads it.
 *
 * Code that Night Shift loads later (`await import(...)`) is a namespace
 * object in the bundle: `__export(exports_x, { name: () => binding })`. The
 * 2026-11-17 nightly left modules out of such a namespace: its getters
 * named bindings that the bundle did not declare. The app started, but
 * every agent session ended with `ReferenceError: withSandbox is not
 * defined`. This check fails the build when a getter of a lazily loaded
 * namespace names a binding that the bundle does not declare.
 *
 * Usage: bun scripts/check-bundle.ts [artifacts folder]
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const folder = process.argv[2] ?? join(import.meta.dir, "../artifacts");

/**
 * Exports known to dangle in every build, by export name. Bun renames these
 * bindings of better-auth's organization plugin, which `@better-auth/api-key`
 * loads only to check a key that an organization owns. Device keys belong
 * to a user, so Night Shift never runs that path.
 */
const KNOWN_DANGLING = new Set([
	"parseRoles",
	"hasPermission",
	"getOrgAdapter",
]);
const MAIN_BUNDLE = /(^|\/)Resources\/app\/bun\/index\.js$/;

function tar(args: string[]): string {
	const result = Bun.spawnSync(["tar", "--zstd", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(`tar ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout.toString();
}

function regexName(name: string): string {
	return name.replace(/\$/g, "\\$");
}

/** The getters of lazily loaded namespaces whose binding is not declared. */
function danglingGetters(bundle: string): string[] {
	const lazy = new Set(
		[
			...bundle.matchAll(
				/\(\) => \((?:init_[\w$]+\(\), )?(exports_[\w$]+)\)\)/g,
			),
		].map((match) => match[1]),
	);
	const dangling: string[] = [];
	for (const block of bundle.matchAll(
		/__export\((exports_[\w$]+), \{([\s\S]*?)\n\}\);/g,
	)) {
		const namespace = block[1] ?? "";
		if (!lazy.has(namespace)) continue;
		for (const getter of (block[2] ?? "").matchAll(
			/^\s*"?([\w$]+)"?: \(\) => ([\w$]+),?$/gm,
		)) {
			if (KNOWN_DANGLING.has(getter[1] ?? "")) continue;
			const binding = getter[2] ?? "";
			const id = regexName(binding);
			const declared = new RegExp(
				[
					`\\b(?:function\\*?|class|var|let|const)\\s+${id}\\b`,
					`[,{]\\s*${id}\\s*[,}=]`,
					`^\\s*${id} = `,
					`,\\s*${id};`,
				].join("|"),
				"m",
			);
			if (!declared.test(bundle)) dangling.push(`${namespace}.${binding}`);
		}
	}
	return dangling;
}

const archives = readdirSync(folder).filter((name) =>
	name.endsWith(".tar.zst"),
);
if (archives.length === 0) {
	throw new Error(`No app archive (*.tar.zst) in ${folder}.`);
}
let failed = false;
for (const archive of archives) {
	const path = join(folder, archive);
	const member = tar(["-tf", path])
		.split("\n")
		.find((name) => MAIN_BUNDLE.test(name));
	if (!member) {
		console.error(`${archive}: no Resources/app/bun/index.js in the archive.`);
		failed = true;
		continue;
	}
	const dangling = danglingGetters(tar(["-xOf", path, member]));
	if (dangling.length > 0) {
		console.error(
			`${archive}: ${dangling.length} lazily loaded exports are not in the bundle: ${dangling.slice(0, 20).join(", ")}`,
		);
		failed = true;
	} else {
		console.log(`${archive}: the bundle is complete.`);
	}
}
if (failed) process.exit(1);
