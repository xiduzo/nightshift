import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCopiesPorts } from "../adapters/out/in-memory-neighbours";
import { readGitHubClone } from "./read-git-hub-clone";

describe("readGitHubClone", () => {
	test("none before a start, then how the clone goes", async () => {
		const { gitHub } = inMemoryCopiesPorts();
		expect(
			readGitHubClone({ computerAccess: inMemoryComputer(), gitHub })(
				NIGHT_SHIFT,
				{ repo: "acme/app" },
			),
		).toBeNull();
		await gitHub.start("acme/app");
		expect(
			readGitHubClone({ computerAccess: inMemoryComputer(), gitHub })(
				NIGHT_SHIFT,
				{ repo: "acme/app" },
			),
		).toMatchObject({
			state: "done",
		});
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = readGitHubClone({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
