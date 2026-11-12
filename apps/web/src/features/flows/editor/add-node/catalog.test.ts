import { describe, expect, test } from "bun:test";
import { kitList, NODE_FAMILIES, VALUE_PRESETS } from "@nightshift/flows";
import type { PaletteItem } from "../../canvas/node-type";
import {
	CATALOG,
	catalogGroups,
	firstSentence,
	offHere,
	PALETTE,
	paletteFamily,
} from "./catalog";

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
		for (const group of catalogGroups()) {
			const kinds = group.entries.map((entry) => entry.add.kind);
			const firstKit = kinds.indexOf("kit");
			if (firstKit < 0) continue;
			expect(kinds.slice(firstKit).every((kind) => kind === "kit")).toBe(true);
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
