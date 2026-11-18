import { describe, expect, test } from "bun:test";
import { kitList, NODE_FAMILIES, VALUE_PRESETS } from "@nightshift/flows";
import type { PaletteItem } from "../../canvas/nodes/node-type";
import {
	CATALOG,
	catalogFamilies,
	firstSentence,
	isPaletteItem,
	offHere,
	PALETTE,
	paletteFamily,
} from "./catalog";

/** The entries the grid's search finds for a word. */
function find(word: string): string[] {
	return catalogFamilies(CATALOG, word).flatMap((family) =>
		[...family.nodes, ...family.kits].map((entry) => entry.key),
	);
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

	test("the grid follows the families, nodes apart from kits, all entries once", () => {
		const families = catalogFamilies(CATALOG);
		expect(families.map((group) => group.family)).toEqual([...NODE_FAMILIES]);
		for (const group of families) {
			for (const entry of group.nodes) {
				expect(entry.family, entry.key).toBe(group.family);
				expect(entry.add.kind, entry.key).not.toBe("kit");
			}
			for (const entry of group.kits) {
				expect(entry.family, entry.key).toBe(group.family);
				expect(entry.add.kind, entry.key).toBe("kit");
			}
		}
		expect(
			families.flatMap((group) => [...group.nodes, ...group.kits]),
		).toHaveLength(CATALOG.length);
	});

	test("a search leaves out the families with no match", () => {
		const families = catalogFamilies(CATALOG, "approve");
		expect(families.map((group) => group.family)).toEqual(["decide"]);
		expect(families[0]?.nodes.map((entry) => entry.key)).toEqual(["gate"]);
		expect(catalogFamilies(CATALOG, "Decide").map((g) => g.family)).toEqual([
			"decide",
		]);
		expect(catalogFamilies(CATALOG, "zzz-nothing")).toEqual([]);
	});

	test("a palette item is a node type the palette has", () => {
		expect(isPaletteItem("agent")).toBe(true);
		expect(isPaletteItem("preset-filter")).toBe(false);
		expect(isPaletteItem(3)).toBe(false);
	});

	test("each kit is under its family, after the nodes, and says it is a kit", () => {
		const kits = CATALOG.filter((entry) => entry.add.kind === "kit");
		expect(kits.map((entry) => entry.key)).toEqual(
			kitList().map((kit) => kit.name),
		);
		for (const kit of kitList()) {
			const entry = kits.find((candidate) => candidate.key === kit.name);
			expect(entry).toMatchObject({
				family: kit.family,
				takes: "nothing",
				label: kit.label,
				badge: "Kit",
				add: { kind: "kit", flow: kit.name },
			});
			expect(kit.flow.description?.startsWith(entry?.blurb ?? "-")).toBe(true);
		}
		expect(
			kits.find((entry) => entry.key === "kit:github/watch-pr")?.family,
		).toBe("hold");
	});

	test("a project without a folder cannot pick a kit that needs one", () => {
		const kits = CATALOG.filter((entry) => entry.add.kind === "kit");
		const off = (folder: boolean) =>
			kits.filter((entry) => offHere(entry, folder)).map((entry) => entry.key);
		expect(off(false)).toEqual(
			kitList()
				.filter((kit) => kit.needsFolder)
				.map((kit) => kit.name),
		);
		expect(off(false)).toContain("kit:github/publish-draft-pr");
		expect(off(false)).toContain("kit:knowledge/files");
		expect(off(false)).not.toContain("kit:feeds/read");
		expect(off(true)).toEqual([]);
		// A node or a preset never needs the folder.
		expect(
			CATALOG.filter((entry) => entry.add.kind !== "kit").some((entry) =>
				offHere(entry, false),
			),
		).toBe(false);
	});

	test("a description gives its first sentence", () => {
		expect(firstSentence("Reads a feed. On its first run, it waits.")).toBe(
			"Reads a feed.",
		);
		expect(
			firstSentence("Save smtps://smtp.example.com:465 first. Then send."),
		).toBe("Save smtps://smtp.example.com:465 first.");
		expect(firstSentence("No full stop")).toBe("No full stop");
		expect(firstSentence(undefined)).toBe("");
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
		expect(find("feed")).toContain("kit:feeds/read");
		expect(find("email")).toContain("kit:email/send");
		expect(find("pull request")).toContain("kit:github/publish-draft-pr");
		expect(find("kit")).toContain("kit:message/send");
	});
});
