import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCopiesPorts } from "../adapters/out/in-memory-neighbours";
import { readGitHubAccess } from "./read-git-hub-access";

describe("readGitHubAccess", () => {
	test("says how the GitHub CLI is signed in", async () => {
		const { gitHub } = inMemoryCopiesPorts();
		expect(
			await readGitHubAccess({ computerAccess: inMemoryComputer(), gitHub })(
				NIGHT_SHIFT,
			),
		).toBe("signed-out");
		gitHub.signIn();
		expect(
			await readGitHubAccess({ computerAccess: inMemoryComputer(), gitHub })(
				NIGHT_SHIFT,
			),
		).toBe("signed-in");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = readGitHubAccess({ computerAccess } as never);
	expect(await computerAccess.whoMay((actor) => act(actor))).toEqual(
		ONLY_THE_OWNER,
	);
});
