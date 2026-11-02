import { expect, test } from "bun:test";

import { DEFAULT_USAGE_ENDPOINT, usageEndpoint, usageLogsUrl } from "./send";

test("a released build sends to the team ingest", () => {
	expect(
		usageEndpoint({ NIGHTSHIFT_VERSION: "0.2.1-nightly.20261102.1" }),
	).toBe(DEFAULT_USAGE_ENDPOINT);
	expect(usageLogsUrl(DEFAULT_USAGE_ENDPOINT)).toBe(
		"https://ingest.xiduzo.com/nightshift/v1/logs",
	);
});

test("an empty endpoint in a released build still uses the team ingest", () => {
	expect(
		usageEndpoint({
			NIGHTSHIFT_VERSION: "0.2.0",
			NIGHTSHIFT_USAGE_ENDPOINT: " ",
		}),
	).toBe(DEFAULT_USAGE_ENDPOINT);
});

test("a chosen endpoint wins", () => {
	expect(
		usageEndpoint({
			NIGHTSHIFT_VERSION: "0.2.0",
			NIGHTSHIFT_USAGE_ENDPOINT: "https://ingest.example.com",
		}),
	).toBe("https://ingest.example.com");
	expect(
		usageEndpoint({ NIGHTSHIFT_USAGE_ENDPOINT: "https://ingest.example.com" }),
	).toBe("https://ingest.example.com");
});

test("a run from source sends nothing", () => {
	expect(usageEndpoint({})).toBe("");
	expect(usageEndpoint({ NIGHTSHIFT_VERSION: "  " })).toBe("");
});
