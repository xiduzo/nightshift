import { describe, expect, test } from "bun:test";

import { spaceMenu } from "./space-menu";

const list = {
	active: "personal",
	spaces: [
		{ id: "personal", name: "Personal" },
		{ id: "team", name: "Team" },
	],
};

describe("the Space menu", () => {
	test("checks the Space this phone works in and shows its name", () => {
		const menu = spaceMenu(list, null, () => undefined);
		expect(menu.value).toBe("personal");
		expect(menu.title).toBe("Personal");
		expect(menu.label).toBe("Space, Personal");
		expect(menu.disabled).toBe(false);
		expect(menu.options).toEqual([
			{ value: "personal", label: "Personal" },
			{ value: "team", label: "Team" },
		]);
	});

	test("checks the Space it switches to, and waits for the switch", () => {
		const menu = spaceMenu(list, "team", () => undefined);
		expect(menu.value).toBe("team");
		expect(menu.title).toBe("Team");
		expect(menu.disabled).toBe(true);
	});

	test("switches only to another Space", () => {
		const picked: string[] = [];
		const menu = spaceMenu(list, null, (id) => picked.push(id));
		menu.onChange("personal");
		menu.onChange("team");
		expect(picked).toEqual(["team"]);
	});

	test("asks to choose when the active Space is not in the list", () => {
		const menu = spaceMenu({ ...list, active: null }, null, () => undefined);
		expect(menu.value).toBeNull();
		expect(menu.title).toBe("Space");
		expect(menu.label).toBe("Choose a Space");
	});
});
