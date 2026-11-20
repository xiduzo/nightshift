import { describe, expect, test } from "bun:test";
import {
	alreadyHere,
	folderName,
	folderTaken,
	HOSTED_NEEDS_REMOTE,
	noActiveRun,
	otherRepository,
	SLEEPS,
	stillRunning,
	WAITS_AT_GATE,
} from "./words";

describe("what a person reads of the Projects", () => {
	test("each sentence whole", () => {
		expect(HOSTED_NEEDS_REMOTE).toBe(
			"Your Host keeps the projects of this Space and copies them from GitHub. Put this folder on GitHub first, then add it again.",
		);
		expect(WAITS_AT_GATE).toBe(
			"A run of this project waits at a Gate. Answer the Gate or stop the run first.",
		);
		expect(SLEEPS).toBe(
			"A run of this project sleeps until a wait ends. Stop it first.",
		);
		expect(stillRunning("remove the project")).toBe(
			"A run of this project is still running. Stop it to remove the project.",
		);
		expect(alreadyHere("/srv/app")).toBe(
			"This computer already has this project, in /srv/app. Choose Change folder in its menu to use this folder instead.",
		);
		expect(folderTaken("lib")).toBe(
			"This folder is the project lib already. Choose another folder.",
		);
		expect(otherRepository(null)).toBe(
			"This folder has a remote repository, and this project has none. Choose the folder of this project.",
		);
		expect(otherRepository("github.com/acme/app")).toBe(
			"This folder holds another repository. Choose a copy of github.com/acme/app.",
		);
	});

	test("a new project of a folder takes the folder's name, unless one is asked", () => {
		expect(folderName("/srv/app")).toBe("app");
		expect(folderName("/srv/app", "Site")).toBe("Site");
	});

	test("noActiveRun refuses while a run of the project runs a step, and gives its runs", async () => {
		const runs = (active: string[]) => ({
			runIds: async () => ["r1", "r2"],
			isActive: (id: string) => active.includes(id),
		});
		expect(await noActiveRun(runs([]), "p1", "change its folder")).toEqual([
			"r1",
			"r2",
		]);
		await expect(
			noActiveRun(runs(["r2"]), "p1", "change its folder"),
		).rejects.toThrow(stillRunning("change its folder"));
	});
});
