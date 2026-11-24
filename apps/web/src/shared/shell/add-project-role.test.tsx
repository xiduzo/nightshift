// Add project in the sidebar follows the role in the Space it adds to.
// Rendered for a Viewer and for a Member of the active Space.
// No request leaves the test: every fetch waits for ever.

import { afterAll, afterEach, expect, mock, test } from "bun:test";
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
	useMatchRoute: () => () => false,
	useRouterState: () => undefined,
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));
const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { projectQueries } = await import("@/features/projects");
const { spaceQueries } = await import("@/features/spaces");
const { SidebarProvider } = await import("@nightshift/ui/components/sidebar");
const { AppSidebar } = await import("./app-sidebar");

afterEach(cleanup);
afterAll(() => {
	globalThis.fetch = realFetch;
});

/** Whether each Add project is disabled. Where the person may add in their own Space, the active one decides. */
async function addIsOff(active: "viewed" | "own", element: ReactNode) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(spaceQueries.list().queryKey, {
		active,
		spaces: [
			{ id: "own", role: "owner" },
			{ id: "viewed", role: "viewer" },
		],
	} as never);
	client.setQueryData(projectQueries.list().queryKey, []);
	render(
		<QueryClientProvider client={client}>
			<SidebarProvider>{element}</SidebarProvider>
		</QueryClientProvider>,
	);
	await act(() => new Promise((done) => setTimeout(done, 50)));
	const found = [
		...document.querySelectorAll<HTMLButtonElement>("button"),
	].filter((one) => one.textContent?.trim() === "Add project");
	expect(found.length).toBe(1);
	return found[0]?.disabled;
}

test("Add project of the sidebar is off in a Space the person only views, and on in their own", async () => {
	expect(await addIsOff("viewed", <AppSidebar />)).toBe(true);
	cleanup();
	expect(await addIsOff("own", <AppSidebar />)).toBe(false);
});
