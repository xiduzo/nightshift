import { describe, expect, test } from "bun:test";
import {
	fakeMeaning,
	inMemorySearchPorts,
} from "../adapters/out/in-memory-neighbours";
import { readIndexForMap } from "./read-index-for-map";

/** The use case readIndexForMap, on in-memory adapters. */

const LIMITS = { maxBytes: 1_000, maxBytesPerFile: 1_000, maxVectors: 10 };

function mapPorts(on = true) {
	const ports = inMemorySearchPorts();
	const refreshed: string[] = [];
	return {
		...ports,
		refreshed,
		read: readIndexForMap({
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

const vector = { path: "a.md", vector: new Float32Array([1, 0]) };

describe("readIndexForMap", () => {
	test("gives the files, their sections and the model's vectors, after a refresh", async () => {
		const t = mapPorts();
		t.meaning.set(fakeMeaning({ closeAt: 0.6 }));
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car."] });
		t.index.vectorsFor("p1", fakeMeaning());
		t.index.setStored([vector]);
		expect(await t.read({ projectId: "p1", limits: LIMITS })).toEqual({
			files: ["a.md"],
			read: [{ path: "a.md", sections: ["A car."] }],
			filesLeftOut: 0,
			vectors: [vector],
			closeAt: 0.6,
		});
		expect(t.refreshed).toEqual(["p1"]);
	});

	test("gives no vectors when the setting is off or nobody measured the model", async () => {
		const off = mapPorts(false);
		off.meaning.set(fakeMeaning({ closeAt: 0.6 }));
		off.index.vectorsFor("p1", fakeMeaning());
		off.index.setStored([vector]);
		expect(await off.read({ projectId: "p1", limits: LIMITS })).toMatchObject({
			vectors: [],
			closeAt: 0.6,
		});
		const unmeasured = mapPorts();
		unmeasured.meaning.set(fakeMeaning());
		unmeasured.index.vectorsFor("p1", fakeMeaning());
		unmeasured.index.setStored([vector]);
		expect(
			await unmeasured.read({ projectId: "p1", limits: LIMITS }),
		).toMatchObject({ vectors: [], closeAt: null });
	});
});
