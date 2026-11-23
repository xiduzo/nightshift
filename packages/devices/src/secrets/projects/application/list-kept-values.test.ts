import { describe, expect, test } from "bun:test";
import { inMemoryProjectsPorts } from "../adapters/out/in-memory-neighbours";
import { listKeptValues } from "./list-kept-values";

const at = { spaceId: "space-1", projectId: "project-1" };

describe("listKeptValues", () => {
	test("the values this computer keeps, the Space's first", async () => {
		const p = inMemoryProjectsPorts();
		await p.store.set(at, "A_TOKEN", "from-project", "person-ada");
		await p.spaceStore.set("space-1", "B_TOKEN", "from-space", "person-ada");
		expect(await listKeptValues(p)({ project: at })).toEqual([
			"from-space",
			"from-project",
		]);
	});

	test("none for a Space a Host keeps", async () => {
		const p = inMemoryProjectsPorts();
		await p.store.set(at, "A_TOKEN", "from-project", "person-ada");
		p.spaces.hosts.set("space-1", "host-1");
		expect(
			await listKeptValues(p)({ project: at, names: ["A_TOKEN"] }),
		).toEqual([]);
	});
});
