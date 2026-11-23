import { describe, expect, test } from "bun:test";

import {
	asksForCode,
	plainText,
	saysSignedIn,
	signInAddress,
	tailOf,
} from "./setup-output";

/** The sign-in hosts of Claude Code and Codex, as their setups give them. */
const CLAUDE_HOSTS = ["claude.ai", "claude.com", "anthropic.com"];
const CODEX_HOSTS = ["openai.com", "chatgpt.com"];

const ESC = "\u001b";
const URL_CLAUDE =
	"https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz";

/** What a CLI may print: colors, a link (OSC 8), a spinner line, the question. */
const ANSI_OUTPUT = [
	`${ESC}[2K${ESC}[1G${ESC}[36m⠋ Opening browser…${ESC}[39m\r`,
	`${ESC}[1mBrowser did not open?${ESC}[22m Use the url below to sign in:\n\n`,
	`${ESC}]8;;${URL_CLAUDE}${ESC}\\${ESC}[4m${URL_CLAUDE}${ESC}[24m${ESC}]8;;${ESC}\\\n\n`,
	`${ESC}[33mPaste code here if prompted >${ESC}[39m `,
].join("");

describe("reading a sign-in's output", () => {
	test("plain text drops colors, links and lines written again", () => {
		const plain = plainText(ANSI_OUTPUT);
		expect(plain).not.toContain(ESC);
		expect(plain).not.toContain("Opening browser");
		expect(plain).toContain(`${URL_CLAUDE}\n`);
		expect(plain).toContain("Paste code here if prompted >");
	});

	test("finds the sign-in address of the vendor in colored output", () => {
		expect(signInAddress(plainText(ANSI_OUTPUT), CLAUDE_HOSTS)).toBe(
			URL_CLAUDE,
		);
		expect(
			signInAddress(
				"Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x\n",
				CODEX_HOSTS,
			),
		).toBe(
			"https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x",
		);
	});

	test("shows no address of another host, a plain http one, or one with a user or port", () => {
		for (const text of [
			"http://claude.ai/oauth/authorize\n",
			"https://claude.ai.example.com/login\n",
			"https://notclaude.ai/login\n",
			"https://evil.example/claude.ai\n",
			"https://claude.ai@evil.example/login\n",
			"https://user:pass@claude.ai/login\n",
			"https://claude.ai:8443/login\n",
			"http://localhost:1455/auth/callback\n",
		]) {
			expect(signInAddress(text, CLAUDE_HOSTS)).toBeNull();
		}
		// A subdomain of the vendor's host is the vendor's.
		expect(
			signInAddress("see https://platform.claude.com/x.\n", CLAUDE_HOSTS),
		).toBe("https://platform.claude.com/x");
	});

	test("an address at the end of the output so far may go on: it waits", () => {
		const cut = "Sign in at https://claude.ai/oauth/auth";
		expect(signInAddress(cut, CLAUDE_HOSTS)).toBeNull();
		expect(signInAddress(cut, CLAUDE_HOSTS, true)).toBe(
			"https://claude.ai/oauth/auth",
		);
	});

	test("knows when the CLI asks for a code, and when it signed in", () => {
		expect(asksForCode("Paste code here if prompted >")).toBe(true);
		expect(asksForCode("Enter the authorization code:")).toBe(true);
		expect(asksForCode("Opening the browser…")).toBe(false);
		expect(saysSignedIn("Login successful.")).toBe(true);
		expect(saysSignedIn("Opening the browser…")).toBe(false);
	});

	test("the tail of a long output starts at a line", () => {
		expect(tailOf("  short  ", 20)).toBe("short");
		expect(tailOf("first line\nsecond line\nthird", 15)).toBe("third");
	});
});
