import { describe, expect, test } from "bun:test";
import { PROJECT_NOT_FOUND } from "../../keep";
import {
	inMemoryCopiesPorts,
	inMemoryCopySpace,
} from "../adapters/out/in-memory-neighbours";
import { NOTHING_TO_COPY } from "../domain/copies";
import { copyProjectHere } from "./copy-project-here";

/** A Space with `app` on GitHub, `lab` elsewhere and `feeds` without a folder; the clone of `app` holds it. */
function seeded() {
	const ports = inMemoryCopiesPorts();
	ports.origins.set("/data/projects/acme/app", "github.com/acme/app");
	const space = inMemoryCopySpace(
		[
			{
				id: "app",
				name: "app",
				repoPath: null,
				remote: "github.com/acme/app",
				folder: true,
			},
			{
				id: "lab",
				name: "lab",
				repoPath: null,
				remote: "gitlab.com/acme/lab",
				folder: true,
			},
			{
				id: "feeds",
				name: "feeds",
				repoPath: null,
				remote: null,
				folder: false,
			},
		],
		(path) => ports.origins.origins.get(path),
	);
	ports.spaces.spaces["space-1"] = space;
	return { ports, space };
}

describe("copyProjectHere", () => {
	test("copies the project from GitHub and adds the clone as its Clone here", async () => {
		const { ports, space } = seeded();
		expect(
			await copyProjectHere(ports)({ space, projectId: "app" }),
		).toBeNull();
		expect(space.added).toEqual(["/data/projects/acme/app"]);
		expect(ports.ground.notes).toBe(1);
		// It has a Clone now: nothing more to copy.
		expect(
			await copyProjectHere(ports)({ space, projectId: "app" }),
		).toBeNull();
		expect(space.added).toHaveLength(1);
	});

	test("refuses a project the Space lacks and one without a folder", async () => {
		const { ports, space } = seeded();
		await expect(
			copyProjectHere(ports)({ space, projectId: "none" }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
		await expect(
			copyProjectHere(ports)({ space, projectId: "feeds" }),
		).rejects.toThrow(NOTHING_TO_COPY);
	});
});
