/**
 * What the input of a tool call says when the call has none.
 *
 * Importing `@testing-library/react` from `src` registers happy-dom first
 * (`test/happy-dom.ts`), so `document` exists before the first query.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { ToolItem } from "../transcript-items";
import { ToolCallRow } from "./tool-call-row";

afterEach(cleanup);

function open(item: Partial<ToolItem>, running: boolean) {
	const { container } = render(
		<ToolCallRow
			item={{
				kind: "tool",
				key: "k",
				sessionId: null,
				at: 1,
				toolCallId: "1",
				name: "say",
				connection: "tracker",
				hasInput: false,
				...item,
			}}
			running={running}
		/>,
	);
	fireEvent.click(screen.getByRole("button"));
	return container.textContent;
}

describe("a tool call without its input", () => {
	test("that runs waits for it", () => {
		expect(open({}, true)).toContain("Not received yet.");
	});

	test("that is over says that it is not known", () => {
		const text = open({ result: "It went away.", failed: true }, true);
		expect(text).toContain("Not known.");
		expect(text).not.toContain("Not received yet.");
		expect(text).toContain("It went away.");
	});

	test("that the step did not finish says so too", () => {
		expect(open({}, false)).toContain("Not known.");
	});
});
