/**
 * scripts/check-semconv.ts, on small sources and on this repository.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkSemconv } from "./check-semconv";

/** A banned prefix, built so this file itself stays clean. */
const genAi = `${["gen", "ai"].join("_")}.`;
const nightshift = `${["night", "shift"].join("")}.`;

describe("a semantic-convention string", () => {
	test("fails a file that writes a convention name", () => {
		const root = mkdtempSync(join(tmpdir(), "check-semconv-"));
		try {
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(
				join(root, "src/bad.ts"),
				[
					`export const name = "${genAi}operation.name";`,
					`export const step = "${nightshift}step";`,
					"",
				].join("\n"),
			);
			expect(checkSemconv(root)).toEqual([
				"src/bad.ts:1 has a semantic-convention string. Import it from @nightshift/semconv.",
				"src/bad.ts:2 has a semantic-convention string. Import it from @nightshift/semconv.",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("passes a file that imports the name, and ignores the generated package", () => {
		const root = mkdtempSync(join(tmpdir(), "check-semconv-"));
		try {
			mkdirSync(join(root, "src"), { recursive: true });
			mkdirSync(join(root, "packages/semconv/src"), { recursive: true });
			mkdirSync(join(root, "packages/telemetry/registry"), {
				recursive: true,
			});
			writeFileSync(
				join(root, "src/ok.ts"),
				[
					'export const pkg = "@nightshift/telemetry";',
					'export const product = "nightshift";',
					`export const file = "${nightshift}db";`,
					`// ${genAi}operation.name stays a comment`,
					"export const n = 1;\n",
				].join("\n"),
			);
			writeFileSync(
				join(root, "packages/semconv/src/generated.ts"),
				`export const name = "${nightshift}run.id";\n`,
			);
			writeFileSync(
				join(root, "packages/telemetry/registry/note.ts"),
				`export const name = "${genAi}provider.name";\n`,
			);
			expect(checkSemconv(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("the command", () => {
	test("it passes on this repository", () => {
		const root = join(import.meta.dir, "..");
		expect(checkSemconv(root)).toEqual([]);
	});
});
