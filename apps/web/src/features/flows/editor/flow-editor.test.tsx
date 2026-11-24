// The flow editor as the person meets it: what it shows in each state, and
// what its keys and effects do. React Flow is a probe here: it records the
// props the canvas gives it and renders nothing. The test runs in a DOM
// (happy-dom), so the effects and the window's key listeners run as in the
// browser. No request leaves the test: every fetch waits for ever.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import type { Flow } from "@nightshift/flows";
import { FLOW_VERSION, newFlow } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import type { ComponentProps, ReactNode } from "react";
import type { Selection } from "./session";

/** Each request the editor sent: none gets an answer. */
const requests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL) => {
	requests.push(
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url,
	);
	return new Promise(() => {});
}) as typeof fetch;

mock.module("@/env", () => ({
	ENV: { NODE_ENV: "test", VITE_SERVER_URL: "http://127.0.0.1:9" },
}));

/** The props of each React Flow on view, by its label. */
const canvases = new Map<string, Record<string, unknown>>();
function ReactFlowProbe(props: Record<string, unknown>) {
	canvases.set(String(props["aria-label"]), props);
	return <div data-probe="react-flow" />;
}
const xyflow = await import("@xyflow/react");
mock.module("@xyflow/react", () => ({ ...xyflow, ReactFlow: ReactFlowProbe }));

/** The toasts the editor showed. */
const toasts: [string, unknown][] = [];
const sonner = await import("sonner");
const record =
	(kind: string) =>
	(message: unknown): string => {
		toasts.push([kind, message]);
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

/** Where the editor went, and the blocker it set. */
const navigations: unknown[] = [];
const blocker: {
	status: "idle" | "blocked";
	reset: () => void;
	proceed: () => void;
	options: { shouldBlockFn?: () => boolean } | null;
	calls: string[];
} = {
	status: "idle",
	reset: () => blocker.calls.push("reset"),
	proceed: () => blocker.calls.push("proceed"),
	options: null,
	calls: [],
};
/** The props a router link takes that are no attribute of `<a>`. */
const ROUTER_PROPS = new Set([
	"activeOptions",
	"activeProps",
	"from",
	"hash",
	"ignoreBlocker",
	"inactiveProps",
	"mask",
	"preload",
	"preloadDelay",
	"reloadDocument",
	"replace",
	"resetScroll",
	"search",
	"startTransition",
	"state",
	"viewTransition",
]);
function LinkProbe({
	to,
	params,
	children,
	...rest
}: {
	to?: string;
	params?: Record<string, string>;
	children?: ReactNode | ((state: { isActive: boolean }) => ReactNode);
	[prop: string]: unknown;
}) {
	const attributes = Object.fromEntries(
		Object.entries(rest).filter(([key]) => !ROUTER_PROPS.has(key)),
	);
	return (
		<a
			href={to}
			data-params={params ? JSON.stringify(params) : undefined}
			{...attributes}
		>
			{typeof children === "function"
				? children({ isActive: false })
				: children}
		</a>
	);
}
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: LinkProbe,
	useNavigate: () => (to: unknown) => {
		navigations.push(to);
		return Promise.resolve();
	},
	useBlocker: (options: { shouldBlockFn?: () => boolean }) => {
		blocker.options = options;
		return blocker;
	},
}));

const { act, cleanup, fireEvent, render } = await import(
	"@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { SidebarProvider } = await import("@nightshift/ui/components/sidebar");
const { spaceQueries } = await import("@/features/spaces");
const { FlowEditor } = await import("./flow-editor");

// The next test file starts with an empty page and the real fetch.
afterAll(() => {
	cleanup();
	globalThis.fetch = realFetch;
});

type EditorProps = ComponentProps<typeof FlowEditor>;

/** A Command node that is ready to run. */
const command = (id: string, x: number, y: number) => ({
	...commandNode(id, { x, y }),
	command: `echo ${id}`,
});

// Five nodes, a Section of two, a Subflow node that calls the flow "child".
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	nodes: [
		command("a", 0, 0),
		command("b", 320, 0),
		command("c", 640, 0),
		command("d", 640, 240),
		{
			id: "e",
			type: "call",
			flow: "child",
			inputs: {},
			position: { x: 960, y: 0 },
		},
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

/** The whole page: the editor and what it put in a portal. */
const page = () => readable(document.body.innerHTML);

/** The page once the timers and frames of this render ran. */
async function settled(): Promise<string> {
	await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
	return page();
}

function mount(
	props: Partial<EditorProps> = {},
	role: "viewer" | "member" = "member",
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	client.setQueryData(spaceQueries.list().queryKey, {
		active: "s1",
		spaces: [{ id: "s1", name: "Team", personal: false, role }],
	} as never);
	const base: EditorProps = {
		projectId: "p1",
		projectName: "Project",
		name: "demo",
		initialFlow: flow,
		initiallySaved: true,
	};
	const element = () => (
		<QueryClientProvider client={client}>
			<SidebarProvider>
				<FlowEditor {...base} {...props} />
			</SidebarProvider>
		</QueryClientProvider>
	);
	const view = render(element());
	return { ...view, again: () => view.rerender(element()) };
}

/** The props the editor's canvas gave React Flow at its last render. */
function canvas(): Record<string, unknown> {
	const props = canvases.get("Flow canvas");
	if (!props) throw new Error("no canvas");
	return props;
}

/** The flow the canvas shows. */
function shown(): Flow {
	const nodes = canvas().nodes as {
		id: string;
		data: { node?: { id: string } };
	}[];
	return {
		...flow,
		nodes: nodes.flatMap((node) =>
			node.data.node ? [node.data.node as Flow["nodes"][number]] : [],
		),
	};
}

/** Calls a handler the canvas gave React Flow, as React Flow would. */
function fire(name: string, ...args: unknown[]) {
	const handler = canvas()[name];
	if (typeof handler !== "function") throw new Error(`no handler ${name}`);
	act(() => {
		handler(...args);
	});
}

/** Selects on the canvas, as a click would. */
function select(selection: Selection) {
	const nodes = canvas().nodes as { id: string }[];
	expect(nodes.length).toBeGreaterThan(0);
	fire("onPaneClick");
	if (selection?.kind === "node") {
		fire("onNodesChange", [
			{ type: "select", id: selection.id, selected: true },
		]);
	} else if (selection?.kind === "edge") {
		fire("onEdgesChange", [
			{ type: "select", id: selection.id, selected: true },
		]);
	} else if (selection?.kind === "nodes") {
		fire(
			"onNodesChange",
			selection.ids.map((id) => ({ type: "select", id, selected: true })),
		);
	}
}

/** Presses a key where nothing has the focus. */
function press(key: string, modifiers: Partial<KeyboardEventInit> = {}) {
	act(() => {
		fireEvent.keyDown(document.body, { key, ...modifiers });
	});
}

/** Moves node `a` as a drop of a drag would. */
function moveA(x: number) {
	fire("onNodesChange", [
		{ type: "position", id: "a", position: { x, y: 0 }, dragging: false },
	]);
}

const at = (id: string) =>
	shown().nodes.find((node) => node.id === id)?.position;

const insideSubflow = () => document.body.querySelector("[inert]") !== null;

// Shiki loads the grammar of a command once, and slowly. One render waits
// for it here, so each snapshot shows the command highlighted.
beforeAll(async () => {
	mount();
	select({ kind: "node", id: "b" });
	for (let tries = 0; tries < 400; tries++) {
		if (document.body.innerHTML.includes("--shiki-light")) break;
		await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
	}
	expect(document.body.innerHTML).toContain("--shiki-light");
	cleanup();
});

beforeEach(() => {
	cleanup();
	canvases.clear();
	requests.length = 0;
	toasts.length = 0;
	navigations.length = 0;
	blocker.status = "idle";
	blocker.calls = [];
	blocker.options = null;
	window.localStorage.clear();
	window.sessionStorage.clear();
});

describe("the flow editor: what it shows", () => {
	test("a saved flow", async () => {
		mount();
		expect(await settled()).toMatchSnapshot();
	});

	test("a new blank flow opens the chat", async () => {
		mount({ initialFlow: newFlow(), initiallySaved: false });
		expect(await settled()).toMatchSnapshot();
	});

	test("a node selected", async () => {
		mount();
		select({ kind: "node", id: "b" });
		expect(await settled()).toMatchSnapshot();
	});

	test("an edge selected", async () => {
		mount();
		select({ kind: "edge", id: "b-success-c" });
		expect(await settled()).toMatchSnapshot();
	});

	test("a Section selected", async () => {
		mount();
		fire("onPaneClick");
		fire("onNodesChange", [
			{ type: "select", id: "section:s1", selected: true },
		]);
		expect(await settled()).toMatchSnapshot();
	});

	test("several nodes selected", async () => {
		mount();
		select({ kind: "nodes", ids: ["a", "b"] });
		expect(await settled()).toMatchSnapshot();
	});

	test("an edit not saved yet", async () => {
		mount();
		moveA(16);
		expect(await settled()).toMatchSnapshot();
	});

	test("the revision link opens the revisions once", async () => {
		const used: string[] = [];
		const view = mount({
			revisionLink: "rev-1",
			onRevisionLinkUsed: () => used.push("revision"),
		});
		act(() => view.again());
		expect(used).toEqual(["revision"]);
		expect(await settled()).toMatchSnapshot();
	});

	test("the chat link opens the chat and is dropped after the first render", async () => {
		const used: string[] = [];
		mount({
			chatLink: { kind: "open" },
			onChatLinkUsed: () => used.push("chat"),
		});
		expect(used).toEqual([]);
		await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
		expect(used).toEqual(["chat"]);
		expect(await settled()).toMatchSnapshot();
	});
});

describe("the flow editor: keys", () => {
	test("Cmd+Z and Cmd+Shift+Z walk the history, a drag is one step", async () => {
		mount();
		fire("onNodesChange", [
			{ type: "position", id: "a", position: { x: 8, y: 0 }, dragging: true },
		]);
		fire("onNodesChange", [
			{ type: "position", id: "a", position: { x: 24, y: 0 }, dragging: false },
		]);
		moveA(40);
		expect(at("a")).toEqual({ x: 40, y: 0 });
		press("z", { metaKey: true });
		expect(at("a")).toEqual({ x: 24, y: 0 });
		press("z", { metaKey: true });
		expect(at("a")).toEqual({ x: 0, y: 0 });
		press("z", { metaKey: true, shiftKey: true });
		expect(at("a")).toEqual({ x: 24, y: 0 });
	});

	test("Cmd+S saves a changed flow, and not an unchanged one", async () => {
		mount();
		const saves = () => requests.filter((url) => url.includes("save"));
		press("s", { metaKey: true });
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(saves()).toEqual([]);
		moveA(16);
		press("s", { metaKey: true });
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(saves().length).toBe(1);
		expect(page()).toContain("Saving");
	});

	test.each(["viewer", "member"] as const)(
		"Save and Cmd+S, as a %s of the Space: off for a viewer only",
		async (role) => {
			mount({}, role);
			// The reads of the mount leave first: a batch does not name what it holds.
			await settled();
			moveA(16);
			const save = [
				...document.body.querySelectorAll<HTMLButtonElement>("button"),
			].find((one) => one.textContent === "Save");
			expect(save?.disabled).toBe(role === "viewer");
			press("s", { metaKey: true });
			await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
			const saves = requests.filter((url) => url.includes("save"));
			expect(saves.length).toBe(role === "viewer" ? 0 : 1);
		},
	);

	test.each(["viewer", "member"] as const)(
		"Copy into project, as a %s of the Space: off for a viewer only",
		async (role) => {
			mount({}, role);
			const more = document.querySelector(
				'[aria-label="More actions for demo"]',
			);
			fireEvent.click(more as Element);
			await settled();
			const items = [
				...document.querySelectorAll<HTMLElement>("[role='menuitem']"),
			];
			const off = (name: string) =>
				items
					.find((one) => one.textContent === name)
					?.getAttribute("aria-disabled") === "true";
			expect(items.map((one) => one.textContent)).toContain(
				"Copy into project…",
			);
			expect(off("Copy into project…")).toBe(role === "viewer");
			expect(off("Export as file")).toBe(false);
		},
	);

	test("Cmd+G makes a Section of the selected nodes", async () => {
		mount();
		select({ kind: "nodes", ids: ["a", "b"] });
		press("g", { metaKey: true });
		const boxes = (canvas().nodes as { id: string }[])
			.map((node) => node.id)
			.filter((id) => id.startsWith("section:"));
		expect(boxes.length).toBe(2);
		expect(await settled()).toMatchSnapshot();
	});

	test("Escape closes the inspector, but not from a field", async () => {
		mount();
		select({ kind: "node", id: "b" });
		const before = await settled();
		const field = document.body.querySelector("input, textarea");
		expect(field).not.toBeNull();
		act(() => {
			fireEvent.keyDown(field as Element, { key: "Escape" });
		});
		expect(await settled()).toBe(before);
		press("Escape");
		expect(canvas().nodes).toBeDefined();
		const selected = (canvas().nodes as { selected?: boolean }[]).filter(
			(node) => node.selected,
		);
		expect(selected).toEqual([]);
		expect(await settled()).not.toBe(before);
		expect(await settled()).toMatchSnapshot();
	});

	test("i looks inside the selected Subflow, Escape goes back", async () => {
		mount();
		select({ kind: "node", id: "e" });
		press("i");
		expect(insideSubflow()).toBe(true);
		expect(await settled()).toMatchSnapshot();
		press("Escape");
		expect(insideSubflow()).toBe(false);
	});

	test("inside a Subflow the edit keys rest", async () => {
		mount();
		moveA(16);
		select({ kind: "node", id: "e" });
		press("i");
		expect(insideSubflow()).toBe(true);
		press("z", { metaKey: true });
		expect(at("a")).toEqual({ x: 16, y: 0 });
		press("u");
		expect(insideSubflow()).toBe(false);
		press("z", { metaKey: true });
		expect(at("a")).toEqual({ x: 0, y: 0 });
	});

	test("the Subflow stack hears Escape before the inspector does", async () => {
		mount();
		select({ kind: "node", id: "e" });
		press("i");
		expect(insideSubflow()).toBe(true);
		// Both listeners start again in one render: the Subflow stack's
		// first, as its hook comes first in the editor.
		fire("onNodesChange", [{ type: "select", id: "e", selected: true }]);
		press("Escape");
		expect(insideSubflow()).toBe(false);
		const selected = (canvas().nodes as { id: string; selected?: boolean }[])
			.filter((node) => node.selected)
			.map((node) => node.id);
		expect(selected).toEqual(["e"]);
		press("Escape");
		const after = (canvas().nodes as { selected?: boolean }[]).filter(
			(node) => node.selected,
		);
		expect(after).toEqual([]);
	});

	test("Tab opens the node grid", async () => {
		mount();
		const before = await settled();
		act(() => {
			fireEvent.pointerDown(document.body);
		});
		press("Tab");
		expect(await settled()).not.toBe(before);
		expect(await settled()).toMatchSnapshot();
	});
});

describe("the flow editor: effects", () => {
	test("something picked outside the open Section shows the whole flow again", async () => {
		mount();
		fire("onNodeDoubleClick", {}, { id: "section:s1" });
		expect(
			(canvas().nodes as { id: string }[]).map((node) => node.id).sort(),
		).toEqual(["c", "d", "outside:in:b", "outside:out:e"]);
		select({ kind: "node", id: "c" });
		expect(
			(canvas().nodes as { id: string }[]).map((node) => node.id).sort(),
		).toEqual(["c", "d", "outside:in:b", "outside:out:e"]);
		fire("onNodesChange", [{ type: "select", id: "a", selected: true }]);
		expect(
			(canvas().nodes as { id: string }[]).map((node) => node.id).sort(),
		).toEqual(["a", "b", "e", "section:s1"]);
	});

	test("leaving with changes asks first", async () => {
		const view = mount();
		expect(blocker.options?.shouldBlockFn?.()).toBe(false);
		moveA(16);
		expect(blocker.options?.shouldBlockFn?.()).toBe(true);
		blocker.status = "blocked";
		act(() => view.again());
		expect(await settled()).toMatchSnapshot();
	});
});
