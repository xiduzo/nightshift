import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryReaderSettings } from "../adapters/out/in-memory-neighbours";
import { chooseReader } from "./choose-reader";

/** The use case chooseReader, on in-memory adapters. */

describe("chooseReader", () => {
	test("saves the project's reader and gives it back as saved", async () => {
		const settings = inMemoryReaderSettings();
		const setting = { kind: "jina", secret: "TEAM_JINA" } as const;
		expect(
			await chooseReader({ access: inMemoryAccess(), settings })({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				setting,
			}),
		).toEqual(setting);
		expect(settings.chosen).toEqual([{ projectId: "p1", setting }]);
		expect(await settings.setting("p1")).toEqual(setting);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = {
			access: inMemoryAccess(),
			settings: inMemoryReaderSettings(),
		};
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					chooseReader(ports)({
						actor,
						spaceId: "space-1",
						projectId: "p1",
						setting: { kind: "jina", secret: "TEAM_JINA" },
					}),
				() => ports.settings.chosen,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
