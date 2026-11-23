import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySavedCliTools } from "../adapters/out/in-memory-saved-cli-tools";
import { saveCliTool } from "./save-cli-tool";

function saving() {
	const saved = inMemorySavedCliTools();
	const save = saveCliTool({ saved, now: () => 1000 });
	return {
		saved,
		save: (input: Parameters<typeof save>[1]) => save(NIGHT_SHIFT, input),
	};
}

describe("saveCliTool", () => {
	test("a tool is saved with its description, and lists by name", async () => {
		const { saved, save } = saving();
		const tool = await save({ name: "gh", description: "GitHub" });
		expect(tool).toEqual({
			name: "gh",
			program: null,
			description: "GitHub",
			login: null,
			git: null,
			updatedAt: 1000,
		});
		expect(saved.read().get("gh")).toEqual(tool);
	});

	test("a program of the tool's own name is saved as none", async () => {
		const { save } = saving();
		expect((await save({ name: "gh", program: "gh" })).program).toBeNull();
		expect((await save({ name: "gh-work", program: "gh" })).program).toBe("gh");
	});

	test("a login that does nothing is saved as none", async () => {
		const { save } = saving();
		const tool = await save({ name: "gh", login: { env: {} } });
		expect(tool.login).toBeNull();
	});

	test("the git host is saved in lower case, with the default helper", async () => {
		const { save } = saving();
		const tool = await save({ name: "gh", git: { host: "GitHub.com" } });
		expect(tool.git).toEqual({
			host: "github.com",
			helper: "auth git-credential",
		});
	});

	test("a git host with a path is refused, and nothing is written", async () => {
		const { saved, save } = saving();
		await expect(
			save({ name: "gh", git: { host: "github.com/org" } }),
		).rejects.toThrow("Use a host name only, for example github.com.");
		expect(saved.writes).toEqual([]);
	});
});
