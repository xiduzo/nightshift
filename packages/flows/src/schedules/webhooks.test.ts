import { describe, expect, test } from "bun:test";
import {
	webhookEvent,
	webhookHolds,
	webhookInputs,
	webhookPath,
	webhookSecretName,
	webhookSignalKey,
} from "./webhooks";

// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

const github = webhookEvent(
	[
		["Content-Type", "application/json"],
		["X-GitHub-Event", "pull_request"],
		["X-Hub-Signature-256", "sha256=abc"],
		["Authorization", "Bearer hunter2"],
		["Cookie", "session=1"],
	],
	JSON.stringify({ action: "opened", pull_request: { number: 7 } }),
);

describe("webhookEvent", () => {
	test("parses a JSON body and keeps the headers without the secret ones", () => {
		expect(github).toEqual({
			body: { action: "opened", pull_request: { number: 7 } },
			headers: {
				"content-type": "application/json",
				"x-github-event": "pull_request",
			},
		});
	});

	test("reads GitHub's form body, keeps other text, and an empty body is null", () => {
		const form = (body: string) =>
			webhookEvent(
				[["content-type", "application/x-www-form-urlencoded"]],
				body,
			).body;
		expect(form(`payload=${encodeURIComponent('{"zen":"hi"}')}`)).toEqual({
			zen: "hi",
		});
		expect(form("a=1&b=2")).toEqual({ a: "1", b: "2" });
		expect(webhookEvent([], "plain text").body).toBe("plain text");
		expect(webhookEvent([], " ").body).toBeNull();
	});
});

describe("a webhook schedule over the event", () => {
	test("when holds, does not hold, or fails", async () => {
		const when = (rule?: string) =>
			webhookHolds(
				{ webhook: { secret: HOOK_SECRET, ...(rule ? { when: rule } : {}) } },
				github,
			);
		expect(await when()).toEqual({ holds: true });
		expect(
			await when('event.headers.`x-github-event` = "pull_request"'),
		).toEqual({ holds: true });
		expect(await when('event.body.action = "closed"')).toEqual({
			holds: false,
		});
		expect(await when("$nope(")).toHaveProperty("error");
	});

	test("the signal key is text, or null without one", async () => {
		expect(await webhookSignalKey({}, github)).toEqual({ key: null });
		expect(
			await webhookSignalKey(
				{ signal: { name: "pr", key: "event.body.pull_request.number" } },
				github,
			),
		).toEqual({ key: "7" });
		expect(
			await webhookSignalKey(
				{ signal: { name: "pr", key: "event.body.missing" } },
				github,
			),
		).toEqual({ key: "" });
	});

	test("inputs render over the event: text as text, one json reference as its value", () => {
		expect(
			webhookInputs(
				{
					inputs: {
						pr: "{{event.body.pull_request.number}}",
						kind: "{{event.headers.x-github-event}}",
						body: "{{event.body}}",
						fixed: "main",
					},
				},
				[
					{ name: "pr", type: "text" },
					{ name: "kind", type: "text" },
					{ name: "body", type: "json" },
				],
				github,
			),
		).toEqual({
			pr: "7",
			kind: "pull_request",
			body: { action: "opened", pull_request: { number: 7 } },
			fixed: "main",
		});
	});

	test("the secret name and the path", () => {
		expect(webhookSecretName(HOOK_SECRET)).toBe("HOOK_SECRET");
		expect(webhookSecretName("HOOK_SECRET")).toBeNull();
		expect(webhookPath("p-1", "review")).toBe("/hooks/p-1/review");
	});
});
