/**
 * scripts/check-time.ts, on small sources and on this repository.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkTime, timeProblems } from "./check-time";

describe("a clock call", () => {
	test("fails on Date, Intl and date-fns", () => {
		const source = [
			'import { format } from "date-fns";',
			"const t = Date.now();",
			"const d = new Date(t);",
			"const iso = d.toISOString();",
			"const local = new Intl.DateTimeFormat().format(d);",
		].join("\n");
		expect(timeProblems(source, "a.ts")).toEqual([
			'a.ts:1 calls `import "date-fns"`. Use @nightshift/time.',
			"a.ts:2 calls `Date.now`. Use @nightshift/time.",
			"a.ts:3 calls `new Date`. Use @nightshift/time.",
			"a.ts:4 calls `.toISOString()`. Use @nightshift/time.",
			"a.ts:5 calls `Intl.DateTimeFormat`. Use @nightshift/time.",
		]);
	});

	test("allows a number grouped by toLocaleString", () => {
		const source = [
			"const lines = 1200;",
			"const text = lines.toLocaleString();",
			"const grouped = lines.toLocaleString('en-US');",
			"const when = new Date(lines).toLocaleString('en-GB', { dateStyle: 'medium' });",
		].join("\n");
		expect(timeProblems(source, "a.ts")).toEqual([
			"a.ts:4 calls `.toLocaleString()`. Use @nightshift/time.",
			"a.ts:4 calls `new Date`. Use @nightshift/time.",
		]);
	});

	test("allows an awaited record-manager getTime", () => {
		const source = "const t = await records.getTime();\n";
		expect(timeProblems(source, "a.ts")).toEqual([]);
	});

	test("allows a Date type and instanceof Date", () => {
		const source =
			"function f(value: Date) { return value instanceof Date; }\n";
		expect(timeProblems(source, "a.ts")).toEqual([]);
	});
});

describe("the debt list", () => {
	test("fails a new file, and a listed file that is clean", () => {
		const root = mkdtempSync(join(tmpdir(), "check-time-"));
		try {
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(join(root, "src/old.ts"), "export const t = Date.now();\n");
			writeFileSync(join(root, "src/clean.ts"), "export const t = 1;\n");
			writeFileSync(
				join(root, "src/fresh.ts"),
				"export const t = new Date();\n",
			);
			const debt = "src/old.ts\nsrc/clean.ts\n";
			expect(checkTime(root, debt)).toEqual([
				"src/fresh.ts:1 calls `new Date`. Use @nightshift/time.",
				"scripts/time-debt.txt: src/clean.ts is clean. Remove it.",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("the command", () => {
	test("it passes on this repository", () => {
		const root = join(import.meta.dir, "..");
		const debt = Bun.file(join(import.meta.dir, "time-debt.txt"));
		expect(checkTime(root, "")).not.toEqual([]);
		return debt.text().then((text) => {
			expect(checkTime(root, text)).toEqual([]);
		});
	});
});
