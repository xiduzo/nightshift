// The message that Night Shift was updated stays while the versions differ,
// and goes when they agree again. No request leaves the test.

import { afterAll, afterEach, expect, mock, test } from "bun:test";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
mock.module("@/env", () => ({
	ENV: { NODE_ENV: "test", VITE_SERVER_URL: "http://127.0.0.1:9" },
}));
const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { versionMessage } = await import("@nightshift/client");
const { Toaster } = await import("sonner");
const { accountQueries } = await import("./queries");
const { VersionNotice } = await import("./version-notice");

afterEach(cleanup);
afterAll(() => {
	globalThis.fetch = realFetch;
});

/** The version of this app: the one it says nothing about. */
const CURRENT = Array.from({ length: 1_000 }, (_, n) => n).findIndex(
	(n) => versionMessage("page", n) === null,
);
const SAID = "Night Shift was updated. Reload this page.";
const said = () => document.body.textContent?.includes(SAID);

test("the message goes when the versions agree again, and comes back when they differ", async () => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	const answer = async (version: number | null) => {
		client.setQueryData(accountQueries.status().queryKey, {
			version,
		} as never);
		// A toast that goes leaves in steps, each after a render.
		for (let i = 0; i < 5; i++) await act(() => Bun.sleep(100));
	};
	render(
		<QueryClientProvider client={client}>
			<VersionNotice />
			<Toaster />
		</QueryClientProvider>,
	);
	await answer(CURRENT);
	expect(said()).toBe(false);
	await answer(CURRENT + 1);
	expect(said()).toBe(true);
	await answer(CURRENT);
	expect(said()).toBe(false);
	await answer(CURRENT + 1);
	expect(said()).toBe(true);
	// Nothing to compare with: the person may not use this Night Shift.
	await answer(null);
	expect(said()).toBe(false);
});
