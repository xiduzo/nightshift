// A flow that cannot be opened: the page says why from the fact the reply
// gives (`flowUnread`), never from the words of its problems. No request
// leaves the test: every fetch waits for ever.

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
mock.module("@/env", () => ({
	ENV: { NODE_ENV: "test", VITE_SERVER_URL: "http://127.0.0.1:9" },
}));
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => () => Promise.resolve(),
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));

const { cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { SidebarProvider } = await import("@nightshift/ui/components/sidebar");
const { flowQueries } = await import("./queries");
const { FlowPage } = await import("./flow-page");

afterEach(cleanup);
afterAll(() => {
	globalThis.fetch = realFetch;
});

/** The page of the flow `night`, with the reply of its read in the cache. */
function pageWith(
	why: "older" | "newer" | "invalid",
	message: string,
): HTMLElement {
	const client = new QueryClient();
	client.setQueryData(flowQueries.get("p1", "night").queryKey, {
		name: "night",
		path: "night",
		flow: null,
		flowUnread: why,
		issues: [{ severity: "error", message }],
	});
	return render(
		<QueryClientProvider client={client}>
			<SidebarProvider>
				<FlowPage projectId="p1" name="night" />
			</SidebarProvider>
		</QueryClientProvider>,
	).container;
}

describe("a flow that cannot be opened", () => {
	test("an older flow cannot be changed or started over, whatever its problem says", () => {
		const page = pageWith("older", "Any other words.");
		expect(page.textContent).toContain("You cannot change or run it.");
		expect(page.textContent).not.toContain("Start over with a new flow");
	});

	test("a flow that is not valid can be started over, also with the words of an older one", () => {
		const page = pageWith(
			"invalid",
			"An older version of Night Shift made this flow.",
		);
		expect(page.textContent).toContain("The saved flow is not valid.");
		expect(page.textContent).toContain("Start over with a new flow");
	});
});
