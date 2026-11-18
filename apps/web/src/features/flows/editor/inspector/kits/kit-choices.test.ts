import { describe, expect, test } from "bun:test";
import { kitList } from "@nightshift/flows";
import { kitChoices } from "./kit-choices";

const choice = (folder: boolean, current: string, name: string) =>
	kitChoices(folder, current).find((kit) => kit.name === name);

describe("the kits a Subflow or a cascade tier can run", () => {
	test("a project with a folder offers every kit as it is", () => {
		const choices = kitChoices(true, "");
		expect(choices.map((kit) => kit.name)).toEqual(
			kitList().map((kit) => kit.name),
		);
		expect(choices.every((kit) => kit.label === kit.name)).toBe(true);
		expect(choices.some((kit) => kit.disabled)).toBe(false);
	});

	test("without a folder, a kit that needs one says so and cannot be picked", () => {
		expect(choice(false, "", "kit:github/publish-draft-pr")).toEqual({
			name: "kit:github/publish-draft-pr",
			label: "kit:github/publish-draft-pr (needs a folder)",
			disabled: true,
		});
		expect(choice(false, "", "kit:knowledge/files")?.disabled).toBe(true);
		// A kit that needs no folder stays as it is.
		expect(choice(false, "", "kit:feeds/read")).toEqual({
			name: "kit:feeds/read",
			label: "kit:feeds/read",
			disabled: false,
		});
	});

	test("the kit picked now stays pickable, and says it needs a folder", () => {
		expect(
			choice(false, "kit:github/create-branch", "kit:github/create-branch"),
		).toEqual({
			name: "kit:github/create-branch",
			label: "kit:github/create-branch (needs a folder)",
			disabled: false,
		});
	});

	test("every kit that needs a folder is the one the registry marks", () => {
		const off = kitChoices(false, "")
			.filter((kit) => kit.disabled)
			.map((kit) => kit.name);
		expect(off).toEqual(
			kitList()
				.filter((kit) => kit.needsFolder)
				.map((kit) => kit.name),
		);
		expect(off.length).toBeGreaterThan(0);
	});
});
