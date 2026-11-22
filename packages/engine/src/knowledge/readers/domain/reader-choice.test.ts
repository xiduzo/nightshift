import { describe, expect, test } from "bun:test";
import { addressOf, keyNameOf, keyOf, readerOf } from "./reader-choice";

const build = {
	local: "own reader",
	service: (kind: string, options: { address: string; key?: string }) =>
		`${kind} at ${options.address}${options.key ? ` with ${options.key}` : ""}`,
};

describe("the reader a setting names", () => {
	test("a service's address and secret: the setting's, else the reader's default", () => {
		expect(keyNameOf({ kind: "jina" })).toBe("JINA_API_KEY");
		expect(keyNameOf({ kind: "firecrawl" })).toBe("FIRECRAWL_API_KEY");
		expect(keyNameOf({ kind: "jina", secret: "TEAM_JINA" })).toBe("TEAM_JINA");
		expect(addressOf({ kind: "jina" })).toBe("https://r.jina.ai/");
		expect(addressOf({ kind: "firecrawl" })).toBe("https://api.firecrawl.dev");
		expect(
			addressOf({ kind: "firecrawl", address: "https://crawl.example" }),
		).toBe("https://crawl.example");
	});

	test("Night Shift's own reader asks for no secret", async () => {
		const asked: string[] = [];
		const secret = async (name: string) => {
			asked.push(name);
			return "x";
		};
		expect(await readerOf({ kind: "nightshift" }, secret, build)).toBe(
			"own reader",
		);
		expect(asked).toEqual([]);
	});

	test("a service gets its key when it is saved, and none when it cannot be read", async () => {
		expect(await readerOf({ kind: "jina" }, async () => "j-1", build)).toBe(
			"jina at https://r.jina.ai/ with j-1",
		);
		expect(
			await readerOf(
				{ kind: "firecrawl" },
				async () => {
					throw new Error("locked");
				},
				build,
			),
		).toBe("firecrawl at https://api.firecrawl.dev");
		expect(await keyOf({ kind: "jina" }, async () => "")).toBeUndefined();
		expect(await keyOf({ kind: "jina" }, undefined)).toBeUndefined();
	});
});
