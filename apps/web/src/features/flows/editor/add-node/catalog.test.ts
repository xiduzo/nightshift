import { describe, expect, test } from "bun:test";
import { NODE_FAMILIES, VALUE_PRESETS } from "@nightshift/flows";
import type { PaletteItem } from "../../canvas/node-type";
import { CATALOG, catalogGroups, PALETTE, paletteFamily } from "./catalog";

/** The entries a search word finds by name or keyword, as cmdk would. */
function find(word: string): string[] {
	return CATALOG.filter((entry) =>
		[entry.key, entry.label, ...entry.keywords].some((text) =>
			text.toLowerCase().includes(word),
		),
	).map((entry) => entry.key);
}

describe("the add-node catalog", () => {
	test("each palette item is in exactly one family, once", () => {
		const nodes = CATALOG.filter((entry) => entry.add.kind === "node");
		expect(nodes.map((entry) => entry.key)).toEqual([...PALETTE]);
		for (const entry of nodes) {
			const item = entry.key as PaletteItem;
			expect(entry.family, item).toBe(paletteFamily(item));
		}
		expect(new Set(CATALOG.map((entry) => entry.key)).size).toBe(
			CATALOG.length,
		);
	});

	test("the palette is in family order: a Gate and a Branch decide", () => {
		const families = PALETTE.map(paletteFamily);
		const order = families.map((family) => NODE_FAMILIES.indexOf(family));
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(paletteFamily("gate")).toBe("decide");
		expect(paletteFamily("branch")).toBe("decide");
	});

	test("the Value presets sit under Shape and take a value", () => {
		const presets = CATALOG.filter((entry) => entry.add.kind === "preset");
		expect(presets.map((entry) => entry.label)).toEqual(
			VALUE_PRESETS.map((preset) => preset.label),
		);
		for (const entry of presets) {
			expect(entry.family).toBe("shape");
			expect(entry.takes).toBe("value");
		}
	});

	test("groups follow the families, nothing before a value, never mixed", () => {
		const groups = catalogGroups();
		const seen = groups.map((group) => `${group.family}:${group.takes}`);
		expect(seen).toEqual([
			"do:nothing",
			"decide:nothing",
			"decide:value",
			"shape:value",
			"hold:nothing",
			"compose:nothing",
		]);
		for (const group of groups) {
			for (const entry of group.entries) {
				expect(entry.takes, entry.key).toBe(group.takes);
				expect(entry.family, entry.key).toBe(group.family);
			}
		}
		expect(groups.flatMap((group) => group.entries)).toHaveLength(
			CATALOG.length,
		);
	});

	test("anyone finds a node by the word they know", () => {
		expect(find("http")).toContain("web-request");
		expect(find("api")).toContain("web-request");
		expect(find("if")).toContain("branch");
		expect(find("approve")).toContain("gate");
		expect(find("csv")).toContain("convert");
		expect(find("yaml")).toContain("convert");
		expect(find("delay")).toContain("wait");
		expect(find("sleep")).toContain("wait");
		expect(find("dedupe")).toContain("preset-unique");
	});
});
