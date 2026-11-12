import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import * as Y from "yjs";
import type { PersistedDocument } from "../documents/ydoc";
import { type FlowDocument, saveFlow } from "./flow-document";

/**
 * Scale of the flow document a run writes into, and of the sync that
 * carries it. A Link sends the update since the other side, not the
 * whole history.
 */

function chain(count: number): Flow {
	const nodes = [];
	const edges = [];
	for (let i = 0; i < count; i++) {
		nodes.push({
			...commandNode(`n${i}`, { x: i * 40, y: 0 }),
			command: "true",
		});
		if (i > 0) {
			edges.push({
				id: `e${i}`,
				from: `n${i - 1}`,
				outcome: "success" as const,
				to: `n${i}`,
			});
		}
	}
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "n0",
		nodes,
		edges,
	};
}

function withCommand(flow: Flow, command: string): Flow {
	return {
		...flow,
		nodes: flow.nodes.map((node, i) =>
			i === 0 && node.type === "command" ? { ...node, command } : node,
		),
	};
}

function memoryDoc(name: string): PersistedDocument {
	const doc = new Y.Doc();
	return {
		name,
		doc,
		revision: () => 0,
		change: (fn) => {
			doc.transact(fn);
			return Promise.resolve();
		},
		flush: () => Promise.resolve(),
		close: () => Promise.resolve(),
	};
}

function memoryFlow(): FlowDocument {
	return {
		projectId: "p",
		current: memoryDoc("flows:p"),
		history: memoryDoc("flows-history:p"),
	};
}

async function save(document: FlowDocument, flow: Flow, at: number) {
	await saveFlow(document, {
		name: "nightly",
		flow,
		kind: "save",
		personId: null,
		deviceId: "mac",
		at,
	});
}

describe("flow sync sends the new revision", () => {
	test("thirty saves stay inside the budget", async () => {
		const document = memoryFlow();
		let flow = chain(40);
		const started = performance.now();
		for (let i = 0; i < 30; i++) {
			flow = withCommand(flow, `true ${i}`);
			await save(document, flow, i + 1);
		}
		expect(performance.now() - started).toBeLessThan(800);
		document.current.doc.destroy();
		document.history.doc.destroy();
	}, 20_000);

	test("the catch-up update is smaller than the history", async () => {
		const document = memoryFlow();
		let flow = chain(40);
		for (let i = 0; i < 24; i++) {
			flow = withCommand(flow, `true ${i}`);
			await save(document, flow, i + 1);
		}
		const history = document.history.doc;
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(history));
		flow = withCommand(flow, "true next");
		await save(document, flow, 100);
		const delta = Y.encodeStateAsUpdate(history, Y.encodeStateVector(peer));
		const full = Y.encodeStateAsUpdate(history);
		expect(delta.byteLength).toBeGreaterThan(0);
		expect(delta.byteLength).toBeLessThan(full.byteLength / 2);
		const started = performance.now();
		Y.applyUpdate(peer, delta);
		expect(performance.now() - started).toBeLessThan(100);
		peer.destroy();
		document.current.doc.destroy();
		document.history.doc.destroy();
	}, 20_000);
});
