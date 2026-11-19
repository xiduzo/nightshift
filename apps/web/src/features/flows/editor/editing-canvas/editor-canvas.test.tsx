// What the editor's canvas hands React Flow, and what it does with what
// React Flow tells it. React Flow itself is a probe here: it records its
// props and renders nothing. The test runs in a DOM (happy-dom), so the
// hooks and their effects run as in the browser.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NodeSample } from "@nightshift/client";
import type { Flow, FlowCheck } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { TestMarksApi } from "../../test-run";

// No request leaves the test: every fetch waits for ever.
const realFetch = globalThis.fetch;
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;

mock.module("@/env", () => ({
	ENV: { NODE_ENV: "test", VITE_SERVER_URL: "http://127.0.0.1:9" },
}));

/** What the canvas gave React Flow at its last render. */
const probe: { props: Record<string, unknown> | null } = { props: null };
function ReactFlowProbe(props: Record<string, unknown>) {
	probe.props = props;
	return <div data-probe="react-flow" />;
}
const xyflow = await import("@xyflow/react");
mock.module("@xyflow/react", () => ({ ...xyflow, ReactFlow: ReactFlowProbe }));

/** The toasts the canvas showed, with their options. */
const toasts: { kind: string; message: unknown; options?: unknown }[] = [];
const sonner = await import("sonner");
const record =
	(kind: string) =>
	(message: unknown, options?: unknown): string => {
		toasts.push({ kind, message, options });
		return String(toasts.length);
	};
mock.module("sonner", () => ({
	...sonner,
	toast: Object.assign(record("toast"), {
		info: record("info"),
		error: record("error"),
		success: record("success"),
		warning: record("warning"),
	}),
}));

// "Lay out" runs ELK in this process: the browser runs it in a worker.
const elkApi = await import("elkjs/lib/elk-api.js");
const elkWorkerPath = "elkjs/lib/elk-worker.min.js";
const { Worker: ElkWorker } = await import(elkWorkerPath);
mock.module("elkjs/lib/elk-api.js", () => ({
	default: class extends elkApi.default {
		constructor(options = {}) {
			super({ ...options, workerFactory: (url) => new ElkWorker(url) });
		}
	},
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { isValidElement } = await import("react");
const { ReactFlowProvider } = xyflow;
const { EditorCanvas } = await import("./editor-canvas");

// The next test file starts with an empty page and the real fetch.
afterAll(() => {
	cleanup();
	globalThis.fetch = realFetch;
});

type CanvasProps = ComponentProps<typeof EditorCanvas>;

// Six nodes (the mini map shows), a Section of two, and two edges between
// one pair of nodes (one drawn line).
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	nodes: [
		commandNode("a", { x: 0, y: 0 }),
		commandNode("b", { x: 320, y: 0 }),
		commandNode("c", { x: 640, y: 0 }),
		commandNode("d", { x: 640, y: 240 }),
		commandNode("e", { x: 960, y: 0 }),
		commandNode("f", { x: 960, y: 240 }),
	],
	edges: [
		{ id: "a-success-b", from: "a", outcome: "success", to: "b" },
		{ id: "a-failure-b", from: "a", outcome: "failure", to: "b" },
		{ id: "b-success-c", from: "b", outcome: "success", to: "c" },
		{ id: "c-success-d", from: "c", outcome: "success", to: "d" },
		{ id: "d-success-e", from: "d", outcome: "success", to: "e" },
	],
	sections: [{ id: "s1", label: "Part", nodes: ["c", "d"] }],
};

// An issue on a node, on an edge and on the Section.
const check: FlowCheck = {
	issues: [
		{ severity: "error", message: "Node issue", nodeId: "b" },
		{ severity: "warning", message: "Node warning", nodeId: "b" },
		{ severity: "error", message: "Edge issue", edgeId: "b-success-c" },
		{ severity: "warning", message: "Edge warning", edgeId: "d-success-e" },
		{ severity: "warning", message: "Section issue", sectionId: "s1" },
	],
	validatorError: null,
};

/** The objects of the fixture, by name: a snapshot names them, not their fields. */
const named = new Map<object, string>([
	[flow, "[the flow]"],
	...flow.nodes.map((node): [object, string] => [node, `[node ${node.id}]`]),
]);

/** The values the canvas hands out, as plain data: functions by name, elements by type. */
function serial(value: unknown, path: object[] = []): unknown {
	if (typeof value === "function") return `fn ${value.name || "anonymous"}`;
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return value;
	const name = named.get(value);
	if (name !== undefined) return name;
	if (path.includes(value)) return "[cycle]";
	const inner = [...path, value];
	if (isValidElement(value)) {
		return {
			element: typeName(value.type),
			props: serial(value.props, inner),
		};
	}
	if (value instanceof Map) {
		return {
			Map: [...value].map(([k, v]) => [serial(k, inner), serial(v, inner)]),
		};
	}
	if (value instanceof Set)
		return { Set: [...value].map((v) => serial(v, inner)) };
	if (Array.isArray(value)) return value.map((v) => serial(v, inner));
	return Object.fromEntries(
		Object.entries(value).map(([key, v]) => [key, serial(v, inner)]),
	);
}

function typeName(type: unknown): string {
	if (typeof type === "string") return type;
	if (typeof type === "function") return type.name;
	const named = type as {
		displayName?: string;
		type?: { name?: string };
		render?: { name?: string };
	};
	return (
		named.displayName ?? named.type?.name ?? named.render?.name ?? "unknown"
	);
}

/**
 * The markup, one tag a line, with React's ids numbered from the first one
 * in the text. An icon keeps its classes, not its drawing.
 */
function readable(html: string): string {
	const seen = new Map<string, string>();
	return html
		.replace(/«[^»]+»|_r_[0-9a-z]+_|:r[0-9a-z]+:/g, (id) => {
			const known = seen.get(id) ?? `id-${seen.size + 1}`;
			seen.set(id, known);
			return known;
		})
		.replace(/(<svg[^>]*class="lucide[^"]*"[^>]*>).*?<\/svg>/g, "$1</svg>")
		.replaceAll("><", ">\n<");
}

/** Where each node is, which edges and Sections the flow has. */
function shape(next: Flow) {
	return {
		start: next.start,
		nodes: next.nodes.map(
			(node) => `${node.id}@${node.position.x},${node.position.y}`,
		),
		edges: next.edges.map((edge) => edge.id),
		sections: (next.sections ?? []).map(
			(section) => `${section.id}:${section.nodes.join(",")}`,
		),
	};
}

/** What the canvas called, by the name of the prop: the arguments of each call. */
type Calls = Record<string, unknown[][]>;

function mount(props: Partial<CanvasProps> = {}) {
	const calls: Calls = {};
	const log =
		(name: string) =>
		(...args: unknown[]) => {
			calls[name] = [...(calls[name] ?? []), args];
		};
	const base: CanvasProps = {
		flow,
		routesKey: "p1/demo",
		check,
		selection: null,
		openSection: null,
		flowLabel: "demo",
		onFlowChange: (change, gesture) =>
			log("onFlowChange")(shape(change(props.flow ?? flow)), gesture),
		onSelect: (next) =>
			log("onSelect")(
				typeof next === "function" ? next(props.selection ?? null) : next,
			),
		onMakeSection: log("onMakeSection"),
		onDropNode: log("onDropNode"),
		onNodeDoubleClick: log("onNodeDoubleClick"),
		onPaneDoubleClick: log("onPaneDoubleClick"),
		onOpenSection: log("onOpenSection"),
	};
	const element = (more: Partial<CanvasProps>) => (
		<ReactFlowProvider>
			<EditorCanvas {...base} {...props} {...more} />
		</ReactFlowProvider>
	);
	const view = render(element({}));
	return {
		calls,
		view,
		rerender: (more: Partial<CanvasProps>) => view.rerender(element(more)),
		props: () => probe.props as Record<string, unknown>,
	};
}

/** Calls a handler React Flow got, as React Flow would. */
function fire(name: string, ...args: unknown[]): unknown {
	const handler = probe.props?.[name];
	if (typeof handler !== "function") throw new Error(`no handler ${name}`);
	let result: unknown;
	act(() => {
		result = handler(...args);
	});
	return result;
}

/** The child of React Flow of this type. */
function child(name: string): ReactElement<Record<string, unknown>> {
	const children = [probe.props?.children as ReactNode].flat(2) as ReactElement<
		Record<string, unknown>
	>[];
	const found = children.find(
		(each) => isValidElement(each) && typeName(each.type) === name,
	);
	if (!found) throw new Error(`no child ${name}`);
	return found;
}

function snapshot(view: { container: HTMLElement }) {
	return {
		html: readable(view.container.innerHTML),
		props: serial(probe.props),
	};
}

const testMarks: TestMarksApi = {
	marks: {
		pinned: { b: { runId: "r1", stepId: "s-b" } },
		skipped: { e: "success" },
	},
	count: { pinned: 1, skipped: 1, total: 2 },
	pinned: new Map(),
	pinsLoading: false,
	pin: () => {},
	skip: () => {},
	unmark: () => {},
	clear: () => {},
};

/** What node `a` gave in a run. */
const sample: NodeSample = {
	runId: "r1",
	stepId: "s-a",
	endedAt: 1_000,
	outcome: "success",
	outputs: {},
	inputs: {},
	changed: false,
};
const samples: ReadonlyMap<string, NodeSample> = new Map([["a", sample]]);

beforeEach(() => {
	cleanup();
	probe.props = null;
	toasts.length = 0;
	window.localStorage.clear();
});

describe("the editor canvas: what React Flow gets", () => {
	test.each([
		["a plain draft", {}],
		["a node selected", { selection: { kind: "node", id: "b" } }],
		["an edge selected", { selection: { kind: "edge", id: "a-failure-b" } }],
		[
			"several nodes and a Section box selected",
			{ selection: { kind: "nodes", ids: ["a", "b"], sections: ["s1"] } },
		],
		["a Section selected", { selection: { kind: "section", id: "s1" } }],
		["a Section open", { openSection: "s1" }],
	] satisfies [string, Partial<CanvasProps>][])("%s", (_, props) => {
		const { view } = mount(props);
		expect(snapshot(view)).toMatchSnapshot();
	});

	test("a proposal on view", () => {
		const proposed: Flow = {
			...flow,
			nodes: [...flow.nodes, commandNode("g", { x: 1280, y: 0 })],
			edges: [
				...flow.edges,
				{ id: "e-success-g", from: "e", outcome: "success", to: "g" },
			],
		};
		const { view } = mount({
			flow: proposed,
			selection: null,
			preview: {
				nodes: new Map([
					["g", "added"],
					["b", "changed"],
				]),
				edges: new Map([["e-success-g", "added"]]),
			},
			samples,
			test: testMarks,
		});
		expect(snapshot(view)).toMatchSnapshot();
	});

	test("test marks and samples, the chat beside it", () => {
		const { view } = mount({
			samples,
			test: testMarks,
			coveredRight: 380,
			selection: { kind: "node", id: "a" },
		});
		expect(snapshot(view)).toMatchSnapshot();
	});
});

describe("the editor canvas: node changes", () => {
	test("a drag is one gesture from its first move to the drop", () => {
		const { calls } = mount();
		for (const [x, dragging] of [
			[10, true],
			[20, true],
			[24, false],
		] as const) {
			fire("onNodesChange", [
				{ type: "position", id: "a", position: { x, y: 8 }, dragging },
			]);
		}
		fire("onNodesChange", [
			{ type: "position", id: "a", position: { x: 40, y: 8 }, dragging: true },
		]);
		fire("onNodesChange", [
			{ type: "position", id: "a", position: { x: 48, y: 8 }, dragging: false },
		]);
		fire("onNodesChange", [
			{
				type: "position",
				id: "b",
				position: { x: 328, y: 0 },
				dragging: false,
			},
		]);
		expect(calls).toMatchSnapshot();
	});

	test("a Section box carries its nodes, and a node in it stays with the box", () => {
		const { calls } = mount();
		fire("onNodesChange", [
			{
				type: "position",
				id: "section:s1",
				position: { x: 700, y: 40 },
				dragging: true,
			},
			{ type: "position", id: "c", position: { x: 0, y: 0 }, dragging: true },
			{ type: "position", id: "a", position: { x: 16, y: 16 }, dragging: true },
		]);
		expect(calls).toMatchSnapshot();
	});

	test("a removed node goes from the flow and from the selection", () => {
		const { calls } = mount({
			selection: { kind: "nodes", ids: ["a", "b"] },
		});
		fire("onNodesChange", [
			{ type: "remove", id: "b" },
			{ type: "remove", id: "section:s1" },
		]);
		expect(calls).toMatchSnapshot();
	});

	test("a select and a size", () => {
		const { calls, props } = mount({ selection: { kind: "node", id: "a" } });
		fire("onNodesChange", [
			{ type: "select", id: "b", selected: true },
			{ type: "select", id: "a", selected: false },
		]);
		fire("onNodesChange", [
			{
				type: "dimensions",
				id: "a",
				dimensions: { width: 240, height: 96 },
				setAttributes: true,
			},
		]);
		const measured = (props().nodes as { id: string; measured?: unknown }[])
			.filter((node) => node.measured !== undefined)
			.map((node) => [node.id, node.measured]);
		expect({ calls, measured }).toMatchSnapshot();
	});
});

describe("the editor canvas: edge changes", () => {
	test("Delete on a drawn line removes the selected edge of it only", () => {
		const { calls } = mount({ selection: { kind: "edge", id: "a-failure-b" } });
		fire("onEdgesChange", [{ type: "remove", id: "a-success-b" }]);
		expect(calls).toMatchSnapshot();
	});

	test("Delete on a drawn line with none of it selected removes all of it", () => {
		const { calls } = mount();
		fire("onEdgesChange", [{ type: "remove", id: "a-success-b" }]);
		expect(calls).toMatchSnapshot();
	});

	test("a select picks the edge, and a box drawn with Shift picks none", () => {
		const { calls } = mount({ selection: { kind: "edge", id: "a-success-b" } });
		fire("onEdgesChange", [
			{ type: "select", id: "b-success-c", selected: true },
			{ type: "select", id: "data:x", selected: true },
		]);
		fire("onEdgesChange", [
			{ type: "select", id: "a-failure-b", selected: false },
		]);
		fire("onSelectionStart");
		fire("onEdgesChange", [
			{ type: "select", id: "c-success-d", selected: true },
		]);
		fire("onSelectionEnd");
		fire("onEdgesChange", [
			{ type: "select", id: "c-success-d", selected: true },
		]);
		expect(calls).toMatchSnapshot();
	});
});

describe("the editor canvas: connect, clicks and drops", () => {
	test("an edge to a box leads to the node its Section starts at", () => {
		const { calls } = mount();
		/** A line drawn from an outcome of `source` to `target`. */
		const line = (source: string, handle: string | null, target: string) => ({
			source,
			sourceHandle: handle,
			target,
			targetHandle: null,
		});
		const valid = [
			fire("isValidConnection", line("a", "success", "b")),
			fire("isValidConnection", line("e", "success", "section:s1")),
			fire("isValidConnection", line("section:s1", "success", "f")),
			fire("isValidConnection", line("e", "success", "section:none")),
		];
		fire("onConnect", line("e", "success", "section:s1"));
		fire("onConnect", line("e", "failure", "f"));
		fire("onConnect", line("e", null, "f"));
		expect({ valid, calls }).toMatchSnapshot();
	});

	test("clicks, double-clicks and a drop", () => {
		const { calls } = mount();
		fire("onPaneClick");
		fire("onNodeDoubleClick", {}, { id: "e" });
		fire("onNodeDoubleClick", {}, { id: "section:s1" });
		const pane = document.createElement("div");
		pane.classList.add("react-flow__pane");
		fire("onDoubleClick", { target: pane, clientX: 12, clientY: 34 });
		fire("onDoubleClick", {
			target: document.createElement("div"),
			clientX: 56,
			clientY: 78,
		});
		const prevented: string[] = [];
		const transfer = {
			types: ["application/x-nightshift-node"],
			dropEffect: "none",
			getData: (type: string) =>
				type === "application/x-nightshift-node" ? "command" : "",
		};
		fire("onDragOver", {
			dataTransfer: transfer,
			preventDefault: () => prevented.push("over"),
		});
		fire("onDragOver", {
			dataTransfer: { ...transfer, types: ["text/plain"] },
			preventDefault: () => prevented.push("over plain"),
		});
		fire("onDrop", {
			dataTransfer: transfer,
			clientX: 90,
			clientY: 12,
			preventDefault: () => prevented.push("drop"),
		});
		const zoom = child("SectionZoom").props;
		act(() => {
			(zoom.onClose as () => void)();
			(zoom.onOpen as (id: string) => void)("s1");
		});
		expect({
			calls,
			prevented,
			dropEffect: transfer.dropEffect,
		}).toMatchSnapshot();
	});

	test("on a proposal, double-clicks and drops do nothing", () => {
		const { calls } = mount({
			preview: { nodes: new Map(), edges: new Map() },
		});
		fire("onNodeDoubleClick", {}, { id: "e" });
		const pane = document.createElement("div");
		pane.classList.add("react-flow__pane");
		fire("onDoubleClick", { target: pane, clientX: 1, clientY: 2 });
		fire("onDrop", {
			dataTransfer: { getData: () => "command" },
			clientX: 1,
			clientY: 2,
			preventDefault: () => {},
		});
		expect(calls).toMatchSnapshot();
	});

	test("Make section from the toolbar, and Escape out of an open Section", () => {
		const { calls, rerender } = mount({
			selection: { kind: "nodes", ids: ["a", "b"], sections: ["s1"] },
		});
		const toolbar = child("NodeToolbar");
		const button = toolbar.props.children as ReactElement<{
			onClick: () => void;
		}>;
		act(() => button.props.onClick());
		act(() => rerender({ openSection: "s1", selection: null }));
		act(() => (child("SectionZoom").props.onClose as () => void)());
		act(() =>
			(child("OpenSectionBar").props.onOpen as (id: string | null) => void)(
				null,
			),
		);
		expect(calls).toMatchSnapshot();
	});
});

describe("the editor canvas: Lay out", () => {
	test("lays the flow out once at a time, keeps its routes, and Undo puts it back", async () => {
		const { calls } = mount();
		const layOut = child("CanvasControls").props.onAutoLayout as () => void;
		await act(async () => {
			layOut();
			layOut();
			for (let tries = 0; tries < 400 && toasts.length === 0; tries++) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		});
		const kept = window.localStorage.length;
		expect(toasts.map((each) => [each.kind, each.message])).toEqual([
			["info", "Laid out the flow."],
		]);
		const changes = () => (calls.onFlowChange ?? []).map(([laid]) => laid);
		expect(changes()).toHaveLength(1);
		expect(changes()[0]).not.toEqual(shape(flow));
		const options = toasts[0]?.options as
			| { action: { label: string; onClick: () => void } }
			| undefined;
		const undo = options?.action ?? { label: "", onClick: () => {} };
		expect(undo.label).toBe("Undo");
		act(() => undo.onClick());
		expect(changes()).toEqual([changes()[0], shape(flow)]);
		expect(kept).toBeGreaterThan(0);
	});
});
