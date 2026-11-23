import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import {
	inMemoryReaderSettings,
	inMemoryReadersAccess,
} from "../adapters/out/in-memory-neighbours";
import { chooseReader } from "./choose-reader";

/** The use case chooseReader, on in-memory adapters. */

describe("chooseReader", () => {
	test("saves the project's reader and gives it back as saved", async () => {
		const settings = inMemoryReaderSettings();
		const setting = { kind: "jina", secret: "TEAM_JINA" } as const;
		expect(
			await chooseReader({ access: inMemoryReadersAccess(), settings })({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				setting,
			}),
		).toEqual(setting);
		expect(settings.chosen).toEqual([{ projectId: "p1", setting }]);
		expect(await settings.setting("p1")).toEqual(setting);
	});
});
