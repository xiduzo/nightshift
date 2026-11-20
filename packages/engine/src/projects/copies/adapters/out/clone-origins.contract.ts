import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CloneOrigins } from "../../application/ports";

/**
 * One adapter of `CloneOrigins` to test, over two clones: `app` with the
 * origin `github.com/acme/app`, `other` with `github.com/acme/other`.
 */
export type CloneOriginsUnderTest = {
	cloneOrigins: CloneOrigins;
	paths: { app: string; other: string; none: string };
	/** The origin of the clone now, as `host/path`. */
	originOf(path: string): Promise<string | null>;
	close(): Promise<void>;
};

/**
 * What every adapter of `CloneOrigins` does.
 * `clone-origins.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function cloneOriginsContract(
	name: string,
	make: () => Promise<CloneOriginsUnderTest>,
): void {
	describe(`CloneOrigins contract: ${name}`, () => {
		let under: CloneOriginsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("the same repository matches, another does not", async () => {
			const { cloneOrigins, paths } = under;
			expect(await cloneOrigins.match(paths.app, "github.com/acme/app")).toBe(
				true,
			);
			expect(await cloneOrigins.match(paths.other, "github.com/acme/app")).toBe(
				false,
			);
			expect(await cloneOrigins.match(paths.none, "github.com/acme/app")).toBe(
				false,
			);
		});

		test("a match in another case takes the project's case", async () => {
			const { cloneOrigins, paths } = under;
			expect(await cloneOrigins.match(paths.app, "github.com/Acme/App")).toBe(
				true,
			);
			expect(await under.originOf(paths.app)).toBe("github.com/Acme/App");
		});
	});
}
