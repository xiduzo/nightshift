import { describe, expect, spyOn, test } from "bun:test";
import {
	fakeMeaning,
	inMemorySearchPorts,
} from "../adapters/out/in-memory-neighbours";
import {
	createVectorStates,
	RETRY_MS,
	type VectorPreparationEvent,
	type VectorPreparationState,
} from "../domain/vector-states";
import { prepareVectors } from "./prepare-vectors";

/** The use case prepareVectors, on in-memory adapters. */

function preparePorts(on = true) {
	const ports = inMemorySearchPorts();
	const events: VectorPreparationEvent[] = [];
	const wake: (() => void)[] = [];
	const states = createVectorStates((event) => {
		events.push(event);
		for (const resolve of wake.splice(0)) resolve();
	});
	const time = { now: 1_000 };
	return {
		...ports,
		states,
		events,
		time,
		prepare: prepareVectors({
			index: ports.index,
			indexing: ports.vectorIndexing,
			meaning: ports.meaning,
			meaningOn: async () => on,
			states,
			clock: () => time.now,
		}),
		/** Resolves once the project is in `state`. */
		async until(projectId: string, state: VectorPreparationState) {
			while (states.stateOf(projectId) !== state) {
				await new Promise<void>((resolve) => wake.push(resolve));
			}
		},
	};
}

describe("prepareVectors", () => {
	test("goes from idle through the queue to ready, on the clock, and indexes every section", async () => {
		const t = preparePorts();
		t.meaning.set(fakeMeaning());
		await t.index.open();
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car.", ""] });
		t.prepare({ projectId: "p1" });
		await t.until("p1", "ready");
		expect(t.events.map((e) => [e.from, e.to, e.at])).toEqual([
			["idle", "queued", 1_000],
			["queued", "preparing", 1_000],
			["preparing", "ready", 1_000],
		]);
		expect(t.vectorIndexing.calls).toEqual([
			{ projectId: "p1", model: "fake-model", ids: ["a.md#0"] },
		]);
	});

	test("queues nothing without a model or an open index, and a ready project stays", async () => {
		const t = preparePorts();
		await t.index.open();
		t.prepare({ projectId: "p1" });
		t.meaning.set(fakeMeaning());
		t.index.close();
		t.prepare({ projectId: "p1" });
		expect(t.events).toEqual([]);
		await t.index.open();
		t.prepare({ projectId: "p1" });
		await t.until("p1", "ready");
		t.prepare({ projectId: "p1" });
		expect(t.events).toHaveLength(3);
	});

	test("goes back to idle when the setting is off or the model is not ready", async () => {
		const t = preparePorts(false);
		t.meaning.set(fakeMeaning());
		await t.index.open();
		t.prepare({ projectId: "p1" });
		await t.until("p1", "idle");
		expect(t.events.map((e) => e.to)).toEqual(["queued", "idle"]);
		expect(t.vectorIndexing.calls).toEqual([]);
	});

	test("says failed, and tries again only after RETRY_MS", async () => {
		const t = preparePorts();
		t.meaning.set(fakeMeaning());
		await t.index.open();
		t.vectorIndexing.failNext(new Error("Ollama stopped."));
		const warned = spyOn(console, "warn").mockImplementation(() => {});
		try {
			t.prepare({ projectId: "p1" });
			await t.until("p1", "failed");
		} finally {
			warned.mockRestore();
		}
		t.time.now += RETRY_MS - 1;
		t.prepare({ projectId: "p1" });
		expect(t.states.stateOf("p1")).toBe("failed");
		t.time.now += 1;
		t.prepare({ projectId: "p1" });
		await t.until("p1", "ready");
		expect(t.vectorIndexing.calls).toHaveLength(2);
	});

	test("prepares again when the sections changed while it ran", async () => {
		const t = preparePorts();
		t.meaning.set(fakeMeaning());
		await t.index.open();
		t.index.seed("p1", { path: "a.md", title: "Cars", texts: ["A car."] });
		const index = t.vectorIndexing.index.bind(t.vectorIndexing);
		let once = true;
		t.vectorIndexing.index = async (...args) => {
			if (once) {
				once = false;
				t.states.sectionsChanged("p1", t.time.now);
			}
			return index(...args);
		};
		t.prepare({ projectId: "p1" });
		await t.until("p1", "ready");
		expect(t.events.map((e) => e.to)).toEqual([
			"queued",
			"preparing",
			"idle",
			"queued",
			"preparing",
			"ready",
		]);
	});
});
