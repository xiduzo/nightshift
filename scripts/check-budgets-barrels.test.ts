/**
 * Barrel width (V4) with sub-verticals, on small packages written to a
 * temporary folder: a barrel counts the names of its own, and a name it
 * passes on from the barrel of a sub-vertical counts on that barrel.
 * `check-budgets.test.ts` holds the other tests of the rule.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { checkBudgets, scopesOf } from "./check-budgets";
import { removeTrees, writeTree } from "./verticals/test-support";

afterAll(removeTrees);

const PKG = "packages/demo";
const RUNS = `${PKG}/src/runs`;

/** `count` names: `step0`, `step1`. */
const names = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** The text of a file that declares each name. */
const declares = (list: string[]) =>
	list.map((name) => `export const ${name} = 1;\n`).join("");

/** A barrel statement that exports the names of another file. */
const from = (list: string[], specifier: string) =>
	`export { ${list.join(", ")} } from "${specifier}";\n`;

/** A folder whose barrel exports `count` names of its own file. */
const folder = (dir: string, prefix: string, count: number) => ({
	[`${dir}/index.ts`]: from(names(prefix, count), "./names"),
	[`${dir}/names.ts`]: declares(names(prefix, count)),
});

/** The budget problems of a package with `files`. */
function check(files: Record<string, string>, pkg = "{}"): string[] {
	const root = writeTree({ [`${PKG}/package.json`]: `${pkg}\n`, ...files });
	return checkBudgets(
		root,
		scopesOf(root),
		{ size: "", folder: "", barrel: "", peerPorts: "" },
		{ peerPorts: {} },
	);
}

const over = (barrel: string, count: number) =>
	`${barrel}: ${count} names of its own, and the limit is 30 (barrel width). Split the vertical into sub-verticals by sub-domain (a name counts on the barrel of its sub-vertical), or take names off the barrel.`;

describe("barrel width with sub-verticals", () => {
	const subs = {
		...folder(`${RUNS}/start`, "start", 20),
		...folder(`${RUNS}/steps`, "step", 20),
	};
	const passedOn =
		from(names("start", 20), "./start") + from(names("step", 20), "./steps");

	test("a parent that passes on 40 names of two sub-verticals passes", () => {
		expect(check({ ...subs, [`${RUNS}/index.ts`]: passedOn })).toEqual([]);
	});

	test("30 names of its own beside the 40 pass, and 31 fail", () => {
		const parent = (count: number) => ({
			...subs,
			[`${RUNS}/index.ts`]: passedOn + from(names("run", count), "./names"),
			[`${RUNS}/names.ts`]: declares(names("run", count)),
		});
		expect(check(parent(30))).toEqual([]);
		expect(check(parent(31))).toEqual([over(`${RUNS}/index.ts`, 31)]);
	});

	test("a sub-vertical barrel of 31 names fails, and its parent does not", () => {
		expect(
			check({
				...folder(`${RUNS}/steps`, "step", 31),
				[`${RUNS}/index.ts`]: from(names("step", 31), "./steps"),
			}),
		).toEqual([over(`${RUNS}/steps/index.ts`, 31)]);
	});

	test("every way to pass a name on counts the same", () => {
		const wide = {
			...folder(`${RUNS}/start`, "start", 30),
			...folder(`${RUNS}/steps`, "step", 30),
			...folder(`${RUNS}/ends`, "end", 30),
		};
		const barrel = [
			'export * from "./start";',
			'export * as steps from "./steps";',
			'import { end0, end1 as last } from "./ends";',
			"export { end0, last };",
			"",
		].join("\n");
		expect(check({ ...wide, [`${RUNS}/index.ts`]: barrel })).toEqual([]);
	});

	test("a deeper sub-vertical counts on its own barrel too", () => {
		const deep = folder(`${RUNS}/steps/agent`, "agent", 30);
		const files = (count: number) => ({
			...deep,
			...folder(`${RUNS}/steps`, "step", count),
			[`${RUNS}/steps/index.ts`]:
				from(names("step", count), "./names") +
				from(names("agent", 30), "./agent"),
			[`${RUNS}/index.ts`]:
				from(names("agent", 30), "./steps/agent") +
				from(names("step", count), "./steps"),
		});
		expect(check(files(30))).toEqual([]);
		expect(check(files(31))).toEqual([over(`${RUNS}/steps/index.ts`, 31)]);
	});

	test("a name from a file inside a sub-vertical counts on the parent", () => {
		expect(
			check({
				...folder(`${RUNS}/steps`, "step", 30),
				[`${RUNS}/index.ts`]:
					from(names("step", 30), "./steps") + from(["step30"], "./steps/more"),
				[`${RUNS}/steps/more.ts`]: declares(["step30"]),
			}),
		).toEqual([]);
		expect(
			check({
				...folder(`${RUNS}/steps`, "step", 31),
				[`${RUNS}/index.ts`]: from(names("step", 31), "./steps/names"),
			}),
		).toEqual([
			over(`${RUNS}/index.ts`, 31),
			over(`${RUNS}/steps/index.ts`, 31),
		]);
	});

	test("a folder with no index.ts is the barrel's own", () => {
		expect(
			check({
				[`${RUNS}/index.ts`]: from(names("step", 31), "./steps/names"),
				[`${RUNS}/steps/names.ts`]: declares(names("step", 31)),
			}),
		).toEqual([over(`${RUNS}/index.ts`, 31)]);
	});

	test("an index.ts in a ring folder is the slice's own", () => {
		const slice = {
			...folder(`${RUNS}/domain`, "rule", 16),
			...folder(`${RUNS}/adapters/out/git`, "git", 15),
		};
		const barrel = (own: number) => ({
			...slice,
			[`${RUNS}/index.ts`]:
				from(names("rule", 16), "./domain") +
				from(names("git", own), "./adapters/out/git"),
		});
		expect(check(barrel(14))).toEqual([]);
		expect(check(barrel(15))).toEqual([over(`${RUNS}/index.ts`, 31)]);
	});

	test("a sub-folder that is an entry of the package counts on the parent", () => {
		const files = {
			...folder(`${RUNS}/contract`, "shape", 31),
			[`${RUNS}/index.ts`]: from(names("shape", 31), "./contract"),
		};
		expect(
			check(
				files,
				'{ "name": "@demo/demo", "exports": { "./contract": "./src/runs/contract/index.ts" } }',
			),
		).toEqual([over(`${RUNS}/index.ts`, 31)]);
	});

	test("a name of another vertical counts", () => {
		expect(
			check({
				...folder(`${PKG}/src/gates`, "gate", 30),
				[`${RUNS}/index.ts`]:
					from(names("gate", 30), "../gates") + from(["run0"], "./names"),
				[`${RUNS}/names.ts`]: declares(["run0"]),
			}),
		).toEqual([over(`${RUNS}/index.ts`, 31)]);
	});
});
