/**
 * Writes `packages/semconv` from the Weaver registry.
 *
 *   bun scripts/generate-semconv.ts
 *
 * The Weaver version is `packages/telemetry/registry/weaver-version.txt`.
 * The binary is cached under `node_modules/.cache` and is not committed.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const version = (
	await Bun.file(
		join(root, "packages/telemetry/registry/weaver-version.txt"),
	).text()
).trim();

function targetTriple(): string {
	if (platform() === "darwin" && arch() === "arm64")
		return "aarch64-apple-darwin";
	if (platform() === "darwin" && arch() === "x64") return "x86_64-apple-darwin";
	if (platform() === "linux" && arch() === "x64")
		return "x86_64-unknown-linux-gnu";
	if (platform() === "linux" && arch() === "arm64")
		return "aarch64-unknown-linux-gnu";
	throw new Error(`No Weaver build for ${platform()} ${arch()}.`);
}

function findBinary(dir: string): string | null {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			const found = findBinary(path);
			if (found) return found;
		} else if (entry.name === "weaver" && entry.isFile()) {
			return path;
		}
	}
	return null;
}

async function weaverBinary(): Promise<string> {
	const cache = join(root, "node_modules/.cache/weaver", version);
	const cached = existsSync(cache) ? findBinary(cache) : null;
	if (cached) return cached;
	mkdirSync(cache, { recursive: true });
	const asset = `weaver-${targetTriple()}.tar.xz`;
	const url = `https://github.com/open-telemetry/weaver/releases/download/${version}/${asset}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Weaver download failed (${response.status}): ${url}`);
	}
	const archive = join(cache, asset);
	await Bun.write(archive, await response.arrayBuffer());
	const extracted = spawnSync("tar", ["-xJf", archive, "-C", cache], {
		stdio: "inherit",
	});
	if (extracted.status !== 0) process.exit(extracted.status ?? 1);
	const binary = findBinary(cache);
	if (!binary) throw new Error(`Weaver archive ${asset} has no weaver binary.`);
	chmodSync(binary, 0o755);
	return binary;
}

const binary = await weaverBinary();
const generated = spawnSync(
	binary,
	[
		"registry",
		"generate",
		"--v2",
		"--skip-policies",
		"--registry",
		join(root, "packages/telemetry/registry"),
		"--templates",
		join(root, "packages/telemetry/templates"),
		"typescript",
		join(root, "packages/semconv/src/registry"),
	],
	{ stdio: "inherit" },
);
if (generated.status !== 0) process.exit(generated.status ?? 1);

const formatted = spawnSync(
	"bunx",
	["biome", "check", "--write", "packages/semconv/src/registry/generated.ts"],
	{ cwd: root, stdio: "inherit" },
);
if (formatted.status !== 0) process.exit(formatted.status ?? 1);
console.log("Generated packages/semconv/src/registry/generated.ts");
