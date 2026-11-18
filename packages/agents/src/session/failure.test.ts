import { describe, expect, test } from "bun:test";
import {
	failureKind,
	isNetworkText,
	isUsageLimitText,
	parseLegacyResetAt,
} from "./failure";

describe("usage-limit text", () => {
	test.each([
		["Claude AI usage limit reached|1760000000", true],
		["You've hit your limit · resets 3pm (Europe/Amsterdam)", true],
		["You've hit your weekly limit", true],
		["5-hour limit reached ∙ resets 3pm", true],
		["Not logged in", false],
		[
			'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization"}}',
			true,
		],
		["HTTP 429: Too Many Requests (https://api.github.com/graphql)", true],
		["You have exceeded your quota", true],
		["API rate limit exceeded for user ID 123456.", true],
		[
			"You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
			false,
		],
	])("%s", (text, expected) => {
		expect(isUsageLimitText(text)).toBe(expected);
	});

	test("legacy reset accepts seconds and milliseconds", () => {
		expect(parseLegacyResetAt("x|1760000000")).toBe(1_760_000_000_000);
		expect(parseLegacyResetAt("x|1760000000123")).toBe(1_760_000_000_123);
		expect(parseLegacyResetAt("no reset")).toBeUndefined();
	});
});

describe("network text", () => {
	test.each([
		"API Error: Connection error.",
		"API Error (Request timed out.)",
		'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
		'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
		"error connecting to api.github.com",
		'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
		"fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com",
		"getaddrinfo ENOTFOUND api.anthropic.com",
		"getaddrinfo EAI_AGAIN api.anthropic.com",
		"connect ECONNREFUSED 127.0.0.1:443",
		"read ECONNRESET",
		"Connection reset by peer",
		"connection refused",
		"ssh: connect to host github.com port 22: Operation timed out",
		"net/http: TLS handshake timeout",
		'Post "https://api.github.com/graphql": unexpected EOF',
		"error: RPC failed; curl 56 LibreSSL SSL_read: Connection reset by peer; fatal: the remote end hung up unexpectedly",
		"HTTP 502: Bad Gateway (https://api.github.com/graphql)",
		"HTTP 503: Service Unavailable",
		"HTTP 504: Gateway Timeout",
		"Network is unreachable",
		"TypeError: fetch failed",
		"socket hang up",
		"You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
	])("network: %s", (text) => {
		expect(failureKind(text)).toBe("network");
		expect(isNetworkText(text)).toBe(true);
		expect(isUsageLimitText(text)).toBe(false);
	});

	test.each([
		"Not logged in · Please run /login",
		"Invalid API key · Please run /login",
		"HTTP 404: Not Found (https://api.github.com/repos/x/y)",
		"HTTP 401: Bad credentials",
		"Claude Code run failed: error_during_execution",
	])("neither: %s", (text) => {
		expect(failureKind(text)).toBeUndefined();
	});

	test("a primary rate limit stays a usage limit, also next to a 5xx word", () => {
		expect(
			failureKind(
				'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
			),
		).toBe("usage-limit");
		expect(failureKind("HTTP 429: Too Many Requests")).toBe("usage-limit");
		expect(failureKind("service unavailable: quota exhausted")).toBe(
			"usage-limit",
		);
	});
});
