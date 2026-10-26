/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { diffLineTone, linkTarget, listMarker } from "./markdown-view";

describe("linkTarget", () => {
	test("a web page opens in the browser", () => {
		expect(linkTarget("https://github.com/x/y/pull/1")).toBe("browser");
		expect(linkTarget("HTTP://example.com")).toBe("browser");
	});

	test("another app's link opens through the system", () => {
		expect(linkTarget("mailto:a@example.com")).toBe("system");
		expect(linkTarget("slack://open")).toBe("system");
	});

	test("a link without a scheme or with a script opens nothing", () => {
		expect(linkTarget("docs/plan.md")).toBeNull();
		expect(linkTarget("#heading")).toBeNull();
		expect(linkTarget("javascript:alert(1)")).toBeNull();
		expect(linkTarget("data:text/html,hi")).toBeNull();
	});
});

describe("diffLineTone", () => {
	test("added and removed lines take a tone, the file headers do not", () => {
		expect(diffLineTone("+ new")).toBe("added");
		expect(diffLineTone("- old")).toBe("removed");
		expect(diffLineTone("+++ b/file.ts")).toBeNull();
		expect(diffLineTone("--- a/file.ts")).toBeNull();
		expect(diffLineTone("@@ -1 +1 @@")).toBeNull();
		expect(diffLineTone(" same")).toBeNull();
	});
});

describe("listMarker", () => {
	test("an ordered list counts from its start, another shows a bullet", () => {
		expect(listMarker(true, 3, 0)).toBe("3.");
		expect(listMarker(true, undefined, 1)).toBe("2.");
		expect(listMarker(false, 1, 4)).toBe("•");
	});
});
