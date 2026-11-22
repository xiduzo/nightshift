import { describe, expect, test } from "bun:test";
import {
	fakeMeaning,
	inMemorySearchPorts,
} from "../adapters/out/in-memory-neighbours";
import { readMapStamp } from "./read-map-stamp";

/** The use case readMapStamp, on in-memory adapters. */

function stampPorts(on = true) {
	const ports = inMemorySearchPorts();
	const refreshed: string[] = [];
	return {
		...ports,
		refreshed,
		stamp: readMapStamp({
			index: ports.index,
			meaning: ports.meaning,
			meaningOn: async () => on,
			refresh: async ({ projectId }) => {
				refreshed.push(projectId);
				return { files: 0, indexed: 0, removed: 0 };
			},
		}),
	};
}

describe("readMapStamp", () => {
	test("changes with the index, after a refresh", async () => {
		const t = stampPorts();
		const before = await t.stamp({ projectId: "p1" });
		expect(t.refreshed).toEqual(["p1"]);
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car."] });
		expect(await t.stamp({ projectId: "p1" })).not.toBe(before);
	});

	test("names the model only when it has a line for close files and the setting is on", async () => {
		const t = stampPorts();
		t.meaning.set(fakeMeaning({ closeAt: 0.6 }));
		expect(JSON.parse(await t.stamp({ projectId: "p1" })).slice(0, 2)).toEqual([
			0.6,
			"fake-model",
		]);
		t.meaning.set(fakeMeaning());
		expect(JSON.parse(await t.stamp({ projectId: "p1" })).slice(0, 2)).toEqual([
			null,
			null,
		]);
		const off = stampPorts(false);
		off.meaning.set(fakeMeaning({ closeAt: 0.6 }));
		expect(
			JSON.parse(await off.stamp({ projectId: "p1" })).slice(0, 2),
		).toEqual([0.6, null]);
	});
});
