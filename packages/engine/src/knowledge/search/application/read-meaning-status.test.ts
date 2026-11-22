import { describe, expect, spyOn, test } from "bun:test";
import {
	fakeMeaning,
	inMemorySearchPorts,
} from "../adapters/out/in-memory-neighbours";
import { createVectorStates } from "../domain/vector-states";
import { readMeaningStatus } from "./read-meaning-status";

/** The use case readMeaningStatus, on in-memory adapters. */

function statusPorts(on = true) {
	const ports = inMemorySearchPorts();
	const states = createVectorStates();
	const prepared: string[] = [];
	return {
		...ports,
		states,
		prepared,
		status: readMeaningStatus({
			index: ports.index,
			meaning: ports.meaning,
			meaningOn: async () => on,
			refresh: async () => ({ files: 0, indexed: 0, removed: 0 }),
			states,
			prepare: ({ projectId }) => {
				prepared.push(projectId);
			},
		}),
	};
}

const quiet = () => spyOn(console, "info").mockImplementation(() => {});

describe("readMeaningStatus", () => {
	test("is off without a model, and turned off by the project's setting", async () => {
		const off = statusPorts();
		expect(await off.status({ projectId: "p1" })).toEqual({
			state: "off",
			model: null,
			done: 0,
			total: 0,
			where: null,
			percent: null,
		});
		const turned = statusPorts(false);
		turned.meaning.set(fakeMeaning({ where: "studio.local" }));
		expect(await turned.status({ projectId: "p1" })).toEqual({
			state: "turned-off",
			model: "fake-model",
			done: 0,
			total: 0,
			where: "studio.local",
			percent: null,
		});
	});

	test("says how far the model's download is, and queues nothing", async () => {
		const t = statusPorts();
		t.meaning.set(
			fakeMeaning({ ready: async () => "downloading", downloaded: () => 40 }),
		);
		const info = quiet();
		try {
			expect(await t.status({ projectId: "p1" })).toMatchObject({
				state: "downloading",
				percent: 40,
			});
		} finally {
			info.mockRestore();
		}
		expect(t.prepared).toEqual([]);
	});

	test("is preparing while the vectors are behind, and queues them", async () => {
		const t = statusPorts();
		t.meaning.set(fakeMeaning());
		t.index.seed("p1", {
			path: "a.md",
			title: "Cars",
			texts: ["A car.", "A van."],
		});
		expect(await t.status({ projectId: "p1" })).toEqual({
			state: "preparing",
			model: "fake-model",
			done: 0,
			total: 2,
			where: null,
			percent: null,
		});
		expect(t.prepared).toEqual(["p1"]);
	});

	test("is on when every section has its vector, and says failed after a failure", async () => {
		const t = statusPorts();
		t.meaning.set(fakeMeaning());
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car."] });
		t.states.move("p1", "ready", 1);
		expect(await t.status({ projectId: "p1" })).toMatchObject({
			state: "on",
			done: 1,
			total: 1,
		});
		t.states.move("p1", "failed", 2);
		expect(await t.status({ projectId: "p1" })).toMatchObject({
			state: "failed",
		});
	});
});
