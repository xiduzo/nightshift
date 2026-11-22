import { describe, expect, test } from "bun:test";
import { inMemoryReaderSettings } from "../adapters/out/in-memory-neighbours";
import { chooseReader } from "./choose-reader";

/** The use case chooseReader, on in-memory adapters. */

describe("chooseReader", () => {
	test("saves the project's reader and gives it back as saved", async () => {
		const settings = inMemoryReaderSettings();
		const setting = { kind: "jina", secret: "TEAM_JINA" } as const;
		expect(
			await chooseReader({ settings })({ projectId: "p1", setting }),
		).toEqual(setting);
		expect(settings.chosen).toEqual([{ projectId: "p1", setting }]);
		expect(await settings.setting("p1")).toEqual(setting);
	});
});
