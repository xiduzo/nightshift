import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryCopiesPorts } from "../adapters/out/in-memory-neighbours";
import { NOT_A_GITHUB_REPO } from "../domain/clones";
import { startGitHubClone } from "./start-git-hub-clone";

describe("startGitHubClone", () => {
	test("starts a clone and returns at once; refuses what is not a GitHub repository", async () => {
		const ports = {
			computerAccess: inMemoryComputer(),
			gitHub: inMemoryCopiesPorts().gitHub,
		};
		expect(
			await startGitHubClone(ports)(NIGHT_SHIFT, { repo: "acme/app" }),
		).toMatchObject({
			state: "done",
		});
		await expect(
			startGitHubClone(ports)(NIGHT_SHIFT, { repo: "nope" }),
		).rejects.toThrow(NOT_A_GITHUB_REPO);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = startGitHubClone({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
