// The prompt field of a resume shows only while a session waits for a prompt.
// A text that the person typed stays when the session is gone.

import { afterAll, afterEach, expect, mock, test } from "bun:test";

import type { StepSummary } from "@/shared/api";

const realFetch = globalThis.fetch;
const sent: string[] = [];
globalThis.fetch = (async (
	input: Request | string | URL,
	init?: RequestInit,
) => {
	sent.push(
		input instanceof Request ? await input.text() : String(init?.body ?? ""),
	);
	return new Response("{}", { status: 500 });
}) as unknown as typeof fetch;
mock.module("@/env", () => ({
	ENV: { NODE_ENV: "test", VITE_SERVER_URL: "http://127.0.0.1:9" },
}));
const { act, cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { ResumeComposer } = await import("./resume-composer");

afterEach(() => {
	cleanup();
	sent.length = 0;
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

const step = {
	id: "s1",
	nodeId: "worker",
	nodeType: "agent",
	scope: null,
	gate: null,
	outcome: "stopped",
} as unknown as StepSummary;

const composer = (session: StepSummary | undefined) => (
	<QueryClientProvider
		client={
			new QueryClient({ defaultOptions: { mutations: { retry: false } } })
		}
	>
		<ResumeComposer runId="run-1" lastStep={step} sessionStep={session} />
	</QueryClientProvider>
);
const field = () => screen.queryByRole("textbox") as HTMLTextAreaElement | null;
const pressResume = async () => {
	await act(async () => {
		fireEvent.submit(document.querySelector("form") as HTMLFormElement);
		await new Promise((done) => setTimeout(done, 20));
	});
};

test("a session waits: a field, which names its agent", () => {
	render(composer(step));
	expect(field()).not.toBeNull();
	expect(document.body.textContent).toContain("The agent at worker");
});

test("no session waits: no field, and the run can continue", async () => {
	render(composer(undefined));
	expect(field()).toBeNull();
	expect(document.body.textContent).toContain(
		"The run continues where it stopped.",
	);
	await pressResume();
	expect(sent).toHaveLength(1);
});

test("the session is gone after the person typed: the text stays and goes nowhere in silence", async () => {
	const { rerender } = render(composer(step));
	fireEvent.change(field() as HTMLTextAreaElement, {
		target: { value: "Use Postgres." },
	});
	rerender(composer(undefined));
	expect(field()?.value).toBe("Use Postgres.");
	expect(document.body.textContent).toContain("No agent waits for a prompt");
	await pressResume();
	// The server refuses it. The text is still there to copy.
	expect(sent[0]).toContain("Use Postgres.");
	expect(field()?.value).toBe("Use Postgres.");
	fireEvent.change(field() as HTMLTextAreaElement, { target: { value: "" } });
	expect(field()).toBeNull();
});
