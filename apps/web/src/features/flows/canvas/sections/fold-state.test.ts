import { describe, expect, test } from "bun:test";
import {
	type FoldStorage,
	foldsStorageKey,
	readFolds,
	withFold,
	writeFolds,
} from "./fold-state";

function memory(): FoldStorage & { items: Map<string, string> } {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => void items.set(key, value),
		removeItem: (key) => void items.delete(key),
	};
}

describe("fold state", () => {
	test("keeps the folded Sections per project and flow", () => {
		const storage = memory();
		writeFolds("p1/flow", new Set(["review", "build"]), storage);
		expect(storage.items.get(foldsStorageKey("p1/flow"))).toBe(
			'["build","review"]',
		);
		expect(readFolds("p1/flow", storage)).toEqual(new Set(["build", "review"]));
		expect(readFolds("p1/other", storage)).toEqual(new Set());
		expect(readFolds("p2/flow", storage)).toEqual(new Set());
	});

	test("nothing folded leaves nothing behind", () => {
		const storage = memory();
		writeFolds("p/f", new Set(["a"]), storage);
		writeFolds("p/f", new Set(), storage);
		expect(storage.items.size).toBe(0);
	});

	test("bad or blocked storage reads as nothing folded, and writes do not throw", () => {
		const storage = memory();
		storage.items.set(foldsStorageKey("p/f"), "{not json");
		expect(readFolds("p/f", storage)).toEqual(new Set());
		storage.items.set(foldsStorageKey("p/f"), '{"a":1}');
		expect(readFolds("p/f", storage)).toEqual(new Set());
		storage.items.set(foldsStorageKey("p/f"), '["a",2]');
		expect(readFolds("p/f", storage)).toEqual(new Set(["a"]));
		const blocked: FoldStorage = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("full");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};
		expect(readFolds("p/f", blocked)).toEqual(new Set());
		expect(() => writeFolds("p/f", new Set(["a"]), blocked)).not.toThrow();
		expect(readFolds("p/f", undefined)).toEqual(new Set());
	});

	test("folds and unfolds one Section", () => {
		const none = new Set<string>();
		const one = withFold(none, "a", true);
		expect(one).toEqual(new Set(["a"]));
		expect(withFold(one, "a", true)).toBe(one);
		expect(withFold(one, "a", false)).toEqual(new Set());
		expect(none.size).toBe(0);
	});
});
