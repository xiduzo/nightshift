import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SavedCliTools } from "../../application/ports";
import type { CliToolEntry } from "../../domain/cli-tool";

/** One store to test: what an adapter of `SavedCliTools` gives the suite. */
export type SavedCliToolsUnderTest = {
	saved: SavedCliTools;
	/** Puts a raw entry in, as an older version or another computer wrote it. */
	put(name: string, value: unknown): Promise<void>;
	close(): Promise<void>;
};

const gh: CliToolEntry = {
	description: "GitHub",
	program: null,
	login: null,
	git: null,
	updatedAt: 1000,
};

/**
 * What every adapter of `SavedCliTools` does.
 * `saved-cli-tools.contract.test.ts` runs it on the in-memory adapter and
 * on the one over the Device document.
 */
export function savedCliToolsContract(
	name: string,
	open: () => Promise<SavedCliToolsUnderTest>,
) {
	describe(`SavedCliTools contract: ${name}`, () => {
		let under: SavedCliToolsUnderTest;
		beforeEach(async () => {
			under = await open();
		});
		afterEach(async () => {
			await under.close();
		});

		test("nothing saved reads as an empty map", () => {
			expect([...under.saved.read()]).toEqual([]);
		});

		test("a write saves a tool under its name, and the next read has it", async () => {
			await under.saved.write("gh", gh);
			expect(under.saved.read().get("gh")).toEqual({ name: "gh", ...gh });
		});

		test("a removal takes the tool out", async () => {
			await under.saved.write("gh", gh);
			await under.saved.write("aws", { ...gh, description: null });
			await under.saved.remove("gh");
			expect([...under.saved.read().keys()]).toEqual(["aws"]);
		});

		for (const field of ["program", "login", "git"] as const) {
			test(`an entry without its ${field} is left out, and the others stay`, async () => {
				const { [field]: _, ...partial } = gh;
				await under.put("partial", partial);
				await under.put("gh", gh);
				expect([...under.saved.read().keys()]).toEqual(["gh"]);
			});
		}

		test("a login this version cannot read reads as none", async () => {
			await under.put("gh", { ...gh, login: { env: { "not a name": "x" } } });
			expect(under.saved.read().get("gh")).toEqual({ name: "gh", ...gh });
		});

		test("an entry or a name this version cannot read is left out", async () => {
			await under.put("gh", { description: null });
			await under.put("not a name", { ...gh });
			expect(under.saved.read().size).toBe(0);
		});
	});
}
