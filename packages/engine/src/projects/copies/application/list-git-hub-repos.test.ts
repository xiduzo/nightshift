import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCopiesPorts } from "../adapters/out/in-memory-neighbours";
import { listGitHubRepos } from "./list-git-hub-repos";

describe("listGitHubRepos", () => {
	test("none while the GitHub CLI is signed out, the person's when signed in", async () => {
		const { gitHub } = inMemoryCopiesPorts();
		expect(
			await listGitHubRepos({ computerAccess: inMemoryComputer(), gitHub })(
				NIGHT_SHIFT,
			),
		).toEqual([]);
		gitHub.signIn();
		expect(
			(
				await listGitHubRepos({ computerAccess: inMemoryComputer(), gitHub })(
					NIGHT_SHIFT,
				)
			).map((r) => r.name),
		).toEqual(["acme/app"]);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = listGitHubRepos({ computerAccess } as never);
	expect(await computerAccess.whoMay((actor) => act(actor))).toEqual(
		ONLY_THE_OWNER,
	);
});
