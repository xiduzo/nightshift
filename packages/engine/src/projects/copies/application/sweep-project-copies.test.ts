import { describe, expect, test } from "bun:test";
import {
	inMemoryCopiesPorts,
	inMemoryCopySpace,
} from "../adapters/out/in-memory-neighbours";
import { NOT_ON_GITHUB } from "../domain/copies";
import { sweepProjectCopies } from "./sweep-project-copies";

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

describe("sweepProjectCopies", () => {
	test("copies each project from GitHub without a Clone here, and notes the one it cannot", async () => {
		const { ports, space } = seeded();
		await sweepProjectCopies(ports)();
		expect(space.added).toEqual(["/data/projects/acme/app"]);
		expect([...ports.state.failed.keys()]).toEqual(["lab"]);
		expect(ports.state.failed.get("lab")?.problem).toBe(NOT_ON_GITHUB);
	});

	test("copies nothing while the switch is off", async () => {
		const { ports, space } = seeded();
		ports.spaces.on = false;
		await sweepProjectCopies(ports)();
		expect(space.added).toEqual([]);
	});

	test("tries a failed copy again only after its wait", async () => {
		const { ports } = seeded();
		await sweepProjectCopies(ports)();
		const asked = ports.gitHub.asked.length;
		await sweepProjectCopies(ports)();
		expect(ports.gitHub.asked).toHaveLength(asked);
		expect(ports.state.failed.get("lab")?.tries).toBe(1);
		ports.ground.at += 5 * 60_000;
		await sweepProjectCopies(ports)();
		expect(ports.state.failed.get("lab")?.tries).toBe(2);
	});
});
