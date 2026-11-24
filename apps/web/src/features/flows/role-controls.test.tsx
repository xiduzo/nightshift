// The controls that a role may not use are disabled: each is rendered for a
// Viewer and for a Member of the active Space, with the data in the cache.
// No request leaves the test: every fetch waits for ever.

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { SinceLastRunNode } from "@nightshift/flows";
import type { ReactNode } from "react";
import type { ScheduleSummary } from "@/shared/api";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
mock.module("@/env", () => ({
	ENV: { NODE_ENV: "test", VITE_SERVER_URL: "http://127.0.0.1:9" },
}));
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => () => Promise.resolve(),
}));

const { act, cleanup, fireEvent, render } = await import(
	"@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { CopyProjectHere, ProjectMenu, projectQueries } = await import(
	"@/features/projects"
);
const { spaceQueries } = await import("@/features/spaces");
const { FlowNotices } = await import("./flow-notices");
const { KeptValue } = await import("./editor/inspector/io/kept-value");
const { MemorySection } = await import(
	"./editor/inspector/results/memory-section"
);
const { flowQueries } = await import("./queries");
const { FlowSchedulesSheet, scheduleQueries, useScheduleBoard } = await import(
	"./schedules"
);

afterEach(cleanup);
afterAll(() => {
	globalThis.fetch = realFetch;
});

const schedule = {
	id: "nightly",
	flow: "night",
	inputs: {},
	cron: "0 22 * * *",
	enabled: true,
	nextAt: null,
	last: null,
	deliveries: [],
	issues: [],
} as unknown as ScheduleSummary;
const project = {
	id: "p1",
	name: "One",
	repoPath: null,
	folder: true,
	remote: null,
} as unknown as Parameters<typeof CopyProjectHere>[0]["project"];
const sinceLastRun = {
	id: "n1",
	type: "since-last-run",
} as unknown as SinceLastRunNode;

function Schedules() {
	const board = useScheduleBoard("p1", true);
	return (
		<FlowSchedulesSheet
			flowName="night"
			open
			onOpenChange={() => {}}
			schedules={[schedule]}
			board={board}
		/>
	);
}

/** The data each control needs to show, and the role of the person. */
function cacheFor(role: "viewer" | "member") {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	const put = (query: { queryKey: readonly unknown[] }, data: unknown) =>
		client.setQueryData(query.queryKey, data);
	put(spaceQueries.list(), { active: "s1", spaces: [{ id: "s1", role }] });
	put(flowQueries.kept("p1", "night"), [{ name: "count", value: 3 }]);
	put(flowQueries.memory("p1", "night"), [
		{ node: "n1", scope: "one", keys: 2, updatedAt: 0 },
		{ node: "n1", scope: "two", keys: 2, updatedAt: 0 },
	]);
	put(flowQueries.notices("p1"), [{ id: "i1", message: "Imported." }]);
	put(projectQueries.sources(), { folderPicker: true });
	put(projectQueries.copies(), []);
	put(scheduleQueries.listLive("p1"), { schedules: [schedule], issues: [] });
	return client;
}

const settle = () => act(() => new Promise((done) => setTimeout(done, 50)));

/** Renders it, opens the menu of `menu`, and reads whether each control is disabled. */
async function disabled(
	role: "viewer" | "member",
	element: ReactNode,
	controls: readonly string[],
	menu?: string,
) {
	render(
		<QueryClientProvider client={cacheFor(role)}>
			{element}
		</QueryClientProvider>,
	);
	await settle();
	if (menu) {
		const trigger = document.querySelector(`[aria-label^="${menu}"]`);
		if (!trigger) throw new Error(`No menu ${menu}`);
		fireEvent.click(trigger);
		await settle();
	}
	const found = [
		...document.querySelectorAll<HTMLElement>("button, [role='menuitem']"),
	];
	return controls.map((name) => {
		const control = found.find((one) => one.textContent?.trim() === name);
		if (!control) throw new Error(`No control ${name}`);
		return (
			control.hasAttribute("disabled") ||
			control.getAttribute("aria-disabled") === "true"
		);
	});
}

describe("a Viewer sees it disabled, a Member can use it", () => {
	const cases: [string, () => ReactNode, string[], string?][] = [
		[
			"reset of a kept value",
			() => (
				<KeptValue
					kept={{ projectId: "p1", flowName: "night" }}
					name="count"
					id="k"
				/>
			),
			["Reset"],
		],
		[
			"forget what a node saw",
			() => (
				<MemorySection projectId="p1" flowName="night" node={sinceLastRun} />
			),
			["Forget", "Forget what it saw"],
		],
		["dismiss a notice", () => <FlowNotices projectId="p1" />, ["Dismiss"]],
		[
			"the folder of a project that is not here",
			() => <CopyProjectHere project={project} />,
			["Choose folder…"],
		],
		[
			"the folder in the menu of a project",
			() => <ProjectMenu project={project} />,
			["Choose folder…"],
			"Actions for One",
		],
		["a new schedule", () => <Schedules />, ["Add schedule"]],
		[
			"the menu of a schedule",
			() => <Schedules />,
			["Pause schedule", "Edit schedule", "Remove schedule"],
			"More for this schedule",
		],
	];
	for (const [name, element, controls, menu] of cases) {
		test(name, async () => {
			expect(await disabled("viewer", element(), controls, menu)).toEqual(
				controls.map(() => true),
			);
			cleanup();
			expect(await disabled("member", element(), controls, menu)).toEqual(
				controls.map(() => false),
			);
		});
	}
});
