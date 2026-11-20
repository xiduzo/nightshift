import { describe, expect, test } from "bun:test";
import {
	inMemoryCopiesPorts,
	inMemoryCopySpace,
} from "../adapters/out/in-memory-neighbours";
import { NOT_A_GITHUB_REPO } from "../domain/clones";
import { startGitHubClone } from "./start-git-hub-clone";

describe("startGitHubClone", () => {
	test("starts a clone and returns at once; refuses what is not a GitHub repository", async () => {
		const ports = { gitHub: inMemoryCopiesPorts().gitHub };
		void inMemoryCopySpace;
		expect(await startGitHubClone(ports)({ repo: "acme/app" })).toMatchObject({
			state: "done",
		});
		await expect(startGitHubClone(ports)({ repo: "nope" })).rejects.toThrow(
			NOT_A_GITHUB_REPO,
		);
	});
});
