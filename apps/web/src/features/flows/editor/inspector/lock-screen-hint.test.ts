import { describe, expect, test } from "bun:test";

import { lockScreenHint } from "./lock-screen-hint";

const option = (name: string) => ({ name });

describe("the lock-screen hint", () => {
	test("off: the notification opens the app", () => {
		expect(lockScreenHint({ options: [option("a"), option("b")] })).toContain(
			"opens the app",
		);
	});

	test("on with two options: Approve picks the first, Reject the second", () => {
		const hint = lockScreenHint({
			lockScreen: true,
			options: [option("merge"), option("close")],
		});
		expect(hint).toContain('Approve picks "merge"');
		expect(hint).toContain('Reject picks "close"');
	});

	test("on with another number of options: it says it has no effect", () => {
		for (const options of [
			[option("a")],
			[option("a"), option("b"), option("c")],
		]) {
			expect(lockScreenHint({ lockScreen: true, options })).toContain(
				"only with exactly two options",
			);
		}
	});
});
