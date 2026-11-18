import { describe, expect, test } from "bun:test";

import { itemBranchName, slugify } from "./item-branch";

describe("item branches", () => {
	test("names are git-safe, from the item id and title, beside the run's branch", () => {
		expect(slugify("  Add Login — über Fast!! ")).toBe("add-login-uber-fast");
		expect(slugify("a".repeat(60))).toHaveLength(48);
		expect(
			itemBranchName("abcd1234", { id: "12", title: "Add: the/login" }),
		).toBe("nightshift/abcd1234-12-add-the-login");
		expect(itemBranchName("abcd1234", { id: "!", title: "?" })).toBe(
			"nightshift/abcd1234-item",
		);
	});
});
