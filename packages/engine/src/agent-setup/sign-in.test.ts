import { describe, expect, test } from "bun:test";
import { harnessSetup } from "@nightshift/agents/harness-facts";

import { plainText } from "./plain-text";
import {
	asksForCode,
	type SignInSight,
	signInAddress,
	startSignIn,
} from "./sign-in";
import { fakeSpawn } from "./test-support";

const claude = harnessSetup("claude-code");
const codex = harnessSetup("codex");
if (!claude || !codex) throw new Error("Claude Code and Codex have a setup.");

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
		expect(signInAddress(plainText(ANSI_OUTPUT), claude.signInHosts)).toBe(
			URL_CLAUDE,
		);
		expect(
			signInAddress(
				"Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x\n",
				codex.signInHosts,
			),
		).toBe(
			"https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x",
		);
	});

	test("shows no address of another host, a plain http one, or one with a user or port", () => {
		const hosts = claude.signInHosts;
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
			expect(signInAddress(text, hosts)).toBeNull();
		}
		// A subdomain of the vendor's host is the vendor's.
		expect(signInAddress("see https://platform.claude.com/x.\n", hosts)).toBe(
			"https://platform.claude.com/x",
		);
	});

	test("an address at the end of the output so far may go on: it waits", () => {
		const cut = "Sign in at https://claude.ai/oauth/auth";
		expect(signInAddress(cut, claude.signInHosts)).toBeNull();
		expect(signInAddress(cut, claude.signInHosts, true)).toBe(
			"https://claude.ai/oauth/auth",
		);
	});

	test("knows when the CLI asks for a code", () => {
		expect(asksForCode("Paste code here if prompted >")).toBe(true);
		expect(asksForCode("Enter the authorization code:")).toBe(true);
		expect(asksForCode("Opening the browser…")).toBe(false);
	});
});

describe("a sign-in", () => {
	test("runs the CLI's own sign-in with pipes, and tells the address and the question", async () => {
		const { spawn, started } = fakeSpawn();
		const sights: SignInSight[] = [];
		const run = startSignIn({
			program: "/home/ada/.local/bin/claude",
			setup: claude,
			spawn,
			home: "/home/ada",
			env: { PATH: "/usr/bin" },
			onSight: (sight) => sights.push(sight),
		});
		const proc = started[0];
		if (!proc) throw new Error("The sign-in did not start.");
		expect(proc.argv).toEqual(["/home/ada/.local/bin/claude", "auth", "login"]);
		expect(proc.options).toMatchObject({
			cwd: "/home/ada",
			io: "pipes",
			input: true,
			env: { PATH: "/usr/bin", NO_COLOR: "1" },
		});
		// The output comes in pieces: the address is cut in two.
		const half = Math.floor(ANSI_OUTPUT.length / 2);
		proc.print(ANSI_OUTPUT.slice(0, half));
		proc.print(ANSI_OUTPUT.slice(half));
		expect(sights.at(-1)).toEqual({ url: URL_CLAUDE, codeNeeded: true });
		expect(sights.every((s) => s.url === null || s.url === URL_CLAUDE)).toBe(
			true,
		);

		run.sendCode("abc#def");
		expect(proc.written).toEqual(["abc#def\n"]);
		expect(sights.at(-1)).toEqual({ url: URL_CLAUDE, codeNeeded: false });
		// A question after the code asks again.
		proc.print("Invalid code. Paste code here if prompted > ");
		expect(sights.at(-1)).toEqual({ url: URL_CLAUDE, codeNeeded: true });

		proc.exit(0);
		expect(await run.ended).toEqual({ kind: "exited", code: 0 });
	});

	test("in a terminal, Enter is a carriage return", async () => {
		const { spawn, started } = fakeSpawn();
		const run = startSignIn({
			program: "codex",
			setup: { ...codex, signInIo: "terminal" },
			spawn,
			home: "/home/ada",
			env: {},
			onSight: () => {},
		});
		const proc = started[0];
		if (!proc) throw new Error("The sign-in did not start.");
		expect(proc.argv).toEqual(["codex", "login"]);
		expect(proc.options.io).toBe("terminal");
		run.sendCode("1234-ABCD");
		expect(proc.written).toEqual(["1234-ABCD\r"]);
		proc.exit(1);
		expect(await run.ended).toEqual({ kind: "exited", code: 1 });
	});

	test("a CLI that waits for a key after it signed in gets one", async () => {
		const { spawn, started } = fakeSpawn();
		const run = startSignIn({
			program: "claude",
			setup: claude,
			spawn,
			home: "/home/ada",
			env: {},
			onSight: () => {},
		});
		started[0]?.print("Login successful. Press Enter to continue…");
		expect(started[0]?.written).toEqual(["\n"]);
		started[0]?.exit(0);
		expect((await run.ended).kind).toBe("exited");
	});

	test("a timeout stops it, and a stop ends it as stopped", async () => {
		const slow = fakeSpawn();
		const timed = startSignIn({
			program: "claude",
			setup: claude,
			spawn: slow.spawn,
			home: "/home/ada",
			env: {},
			onSight: () => {},
			timeoutMs: 20,
		});
		expect(await timed.ended).toEqual({ kind: "timed-out" });
		expect(slow.started[0]?.stopped).toBe(true);

		const cancelled = fakeSpawn();
		const run = startSignIn({
			program: "claude",
			setup: claude,
			spawn: cancelled.spawn,
			home: "/home/ada",
			env: {},
			onSight: () => {},
		});
		run.stop();
		expect(await run.ended).toEqual({ kind: "stopped" });
		expect(cancelled.started[0]?.stopped).toBe(true);
	});
});
