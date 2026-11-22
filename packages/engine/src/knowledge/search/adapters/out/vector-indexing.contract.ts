import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SectionToEmbed } from "../../../../search-index";
import type { VectorIndexing } from "../../application/ports";
import type { KnowledgeMeaning } from "../../domain/meaning";

/** One adapter of `VectorIndexing` to test. */
export type VectorIndexingUnderTest = {
	vectorIndexing: VectorIndexing;
	/** The model it embeds with. */
	model: Pick<KnowledgeMeaning, "model" | "embeddings">;
	/** How many sections of the project have a vector now. */
	count(projectId: string): number;
	close(): Promise<void>;
};

const section = (path: string, text: string): SectionToEmbed => ({
	path,
	title: path,
	heading_path: "",
	text,
	section_id: `${path}:${text}`,
});

/**
 * What every adapter of `VectorIndexing` does.
 * `vector-indexing.contract.test.ts` runs it on the in-memory adapter and on
 * the real one.
 */
export function vectorIndexingContract(
	name: string,
	make: () => Promise<VectorIndexingUnderTest>,
): void {
	describe(`VectorIndexing contract: ${name}`, () => {
		let under: VectorIndexingUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("gives each section a vector", async () => {
			const { vectorIndexing, model } = under;
			await vectorIndexing.index("p1", model, [
				section("a.md", "A car."),
				section("b.md", "A kitten."),
			]);
			expect(under.count("p1")).toBe(2);
		});

		test("drops the vectors of the sections that went", async () => {
			const { vectorIndexing, model } = under;
			await vectorIndexing.index("p1", model, [
				section("a.md", "A car."),
				section("b.md", "A kitten."),
			]);
			await vectorIndexing.index("p1", model, [section("a.md", "A car.")]);
			expect(under.count("p1")).toBe(1);
		});

		test("keeps the projects apart", async () => {
			const { vectorIndexing, model } = under;
			await vectorIndexing.index("p1", model, [
				section("a.md", "A car."),
				section("b.md", "A kitten."),
			]);
			await vectorIndexing.index("p2", model, [section("a.md", "A car.")]);
			expect(under.count("p1")).toBe(2);
			expect(under.count("p2")).toBe(1);
		});
	});
}
