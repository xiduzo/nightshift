import { describe, expect, test } from "bun:test";

import {
	binaryEntrySource,
	binaryVersion,
	DESKTOP_VERSION_FALLBACK,
} from "./binary-version";

describe("the binary version", () => {
	test("NIGHTSHIFT_VERSION at build time is the one the entry pins", () => {
		expect(
			binaryVersion({ NIGHTSHIFT_VERSION: "0.2.1-nightly.20261020.12" }),
		).toBe("0.2.1-nightly.20261020.12");
	});

	test("an unset build uses the desktop fallback", () => {
		expect(binaryVersion({})).toBe(DESKTOP_VERSION_FALLBACK);
		expect(binaryVersion({ NIGHTSHIFT_VERSION: "" })).toBe(
			DESKTOP_VERSION_FALLBACK,
		);
	});

	test("the generated entry contains the version it was given", () => {
		const version = "0.2.1-nightly.20261020.12";
		const source = binaryEntrySource({
			version,
			imports: [
				`import f0 from ${JSON.stringify("/web/index.html")} with { type: "file" };`,
				`import f1 from ${JSON.stringify("/migrations/0001/migration.sql")} with { type: "file" };`,
			],
			web: [`${JSON.stringify("/index.html")}: f0`],
			migrations: [`${JSON.stringify("0001/migration.sql")}: f1`],
			cli: "/src/cli.ts",
		});

		expect(source).toContain(
			`process.env.NIGHTSHIFT_VERSION ??= ${JSON.stringify(version)};`,
		);
		expect(source.indexOf("NIGHTSHIFT_VERSION")).toBeLessThan(
			source.indexOf("await import"),
		);
		expect(source).toContain('with { type: "file" }');
		expect(source).toContain(
			`setEmbedded({ web: { ${JSON.stringify("/index.html")}: f0 }, migrations: { ${JSON.stringify("0001/migration.sql")}: f1 } });`,
		);
		expect(source).toContain("await main(process.argv.slice(2));");
	});
});
