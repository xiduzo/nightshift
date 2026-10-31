import { describe, expect, test } from "bun:test";
import type { AskForm } from "@nightshift/flows";

import { askImageUrl, askSentSummary, askWebUrl } from "./ask-view";

const HOST = "https://studio.example.com";

describe("an Ask on the phone", () => {
	test("its web page is the Gate's page in the inbox of the Host", () => {
		expect(askWebUrl(HOST, { runId: "r1", stepId: "s 1" })).toBe(
			"https://studio.example.com/inbox?gate=s%201",
		);
	});

	test("an image loads from the Host when the Host walks the run", () => {
		const image = { label: "Home", artifactId: "a1", mediaType: "image/png" };
		expect(askImageUrl(HOST, "r1", image, true)).toBe(
			"https://studio.example.com/api/runs/r1/artifacts/a1",
		);
		expect(askImageUrl(HOST, "r1", image, false)).toBeNull();
		expect(
			askImageUrl(HOST, "r1", { ...image, mediaType: "application/pdf" }, true),
		).toBeNull();
		expect(
			askImageUrl(HOST, "r1", { label: "x", url: "https://example.com" }, true),
		).toBeNull();
	});

	test("the sent card names the chosen choices, else says your answers", () => {
		const form: AskForm = {
			schema: { type: "object" },
			choices: {
				field: "pick",
				items: [
					{ name: "a", label: "Calm" },
					{ name: "b", label: "Bold" },
				],
			},
		};
		expect(askSentSummary(form, { pick: "b" })).toBe("Bold");
		expect(askSentSummary(form, { pick: ["a", "b"] })).toBe("Calm, Bold");
		expect(askSentSummary({ schema: {} }, { ok: true })).toBe("Your answers");
	});
});
