import { describe, expect, test } from "bun:test";

import { plainText } from "./plain-text";

describe("plainText", () => {
	test("drops emphasis and keeps a link's text", () => {
		expect(plainText("**Ship** the [fix](https://x)?")).toBe("Ship the fix?");
	});

	test("drops italic, strike and code marks", () => {
		expect(plainText("_Merge_ ~~now~~ `main.ts` *today*?")).toBe(
			"Merge now main.ts today?",
		);
	});

	test("an image shows its alt text", () => {
		expect(plainText("See ![the chart](https://x/c.png) first")).toBe(
			"See the chart first",
		);
	});

	test("heading, list and quote marks go", () => {
		expect(plainText("## Ship it?")).toBe("Ship it?");
		expect(plainText("- one\n- two")).toBe("one two");
		expect(plainText("> Quoted *line*")).toBe("Quoted line");
		expect(plainText("1. first\n2. second")).toBe("first second");
	});

	test("whitespace and line breaks fold into one space", () => {
		expect(plainText("  Ship\nthe   fix  \n\n now? ")).toBe(
			"Ship the fix now?",
		);
	});

	test("snake_case, 2 * 3 and a bare URL stay as they are", () => {
		expect(plainText("Set max_steps to 2 * 3 at https://x.test/a?")).toBe(
			"Set max_steps to 2 * 3 at https://x.test/a?",
		);
	});

	test("raw HTML and escaped marks stay as text", () => {
		expect(plainText("Merge <branch> into \\*main\\*?")).toBe(
			"Merge <branch> into *main*?",
		);
	});

	test("plain text and an empty string pass through", () => {
		expect(plainText("Ship it?")).toBe("Ship it?");
		expect(plainText("")).toBe("");
	});
});
