import { expect, test } from "bun:test";

import { ingestRequest } from "./request";

const FORWARDED = "203.0.113.10";
const CONNECTING = "198.51.100.20";

test("CF-IPCountry is stored and a forwarded address is not the country", async () => {
	const seen = capture();
	const logs = silence();
	try {
		const response = await ingestRequest(
			seen.db,
			logsRequest({
				"cf-ipcountry": "de",
				"x-forwarded-for": FORWARDED,
				"cf-connecting-ip": CONNECTING,
				"x-real-ip": "192.0.2.10",
			}),
		);
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(seen.countries).toEqual(["DE"]);
		expect(text).not.toContain(FORWARDED);
		expect(text).not.toContain(CONNECTING);
		expect(logs.text).not.toContain(FORWARDED);
		expect(logs.text).not.toContain(CONNECTING);
		expect(logs.text).not.toContain("de");
	} finally {
		logs.restore();
	}
});

test("a forwarded address is not stored when CF-IPCountry is missing or not a code", async () => {
	const missing = capture();
	await ingestRequest(
		missing.db,
		logsRequest({ "x-forwarded-for": "US", "cf-connecting-ip": CONNECTING }),
	);
	expect(missing.countries).toEqual([null]);

	const words = capture();
	await ingestRequest(
		words.db,
		logsRequest({
			"cf-ipcountry": "Netherlands",
			"x-forwarded-for": FORWARDED,
		}),
	);
	expect(words.countries).toEqual([null]);
});

test("a body over 256 KB is refused and nothing is stored", async () => {
	const seen = capture();
	const response = await ingestRequest(
		seen.db,
		new Request("http://127.0.0.1/v1/logs", {
			method: "POST",
			body: "x".repeat(256 * 1024 + 1),
		}),
	);
	expect(response.status).toBe(413);
	expect(seen.countries).toEqual([]);
});

function capture() {
	const countries: Array<string | null> = [];
	const db = {
		insert: () => ({
			values: (rows: Array<{ country: string | null }>) => {
				for (const row of rows) countries.push(row.country);
				return Promise.resolve();
			},
		}),
	};
	return { db: db as never, countries };
}

function logsRequest(headers: Record<string, string>): Request {
	const eventName = `${["night", "shift"].join("")}.schedule.fired`;
	return new Request("http://127.0.0.1/v1/logs", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify({
			resourceLogs: [
				{
					resource: {
						attributes: [
							{
								key: "service.instance.id",
								value: { stringValue: "install-1" },
							},
							{ key: "service.version", value: { stringValue: "1.2.3" } },
							{ key: "os.type", value: { stringValue: "darwin" } },
							{ key: "host.arch", value: { stringValue: "arm64" } },
						],
					},
					scopeLogs: [
						{
							logRecords: [
								{
									timeUnixNano: "1700000000000000000",
									attributes: [
										{ key: "event.name", value: { stringValue: eventName } },
									],
								},
							],
						},
					],
				},
			],
		}),
	});
}

function silence() {
	const lines: string[] = [];
	const methods = ["log", "info", "debug", "warn", "error"] as const;
	const previous = {
		log: console.log,
		info: console.info,
		debug: console.debug,
		warn: console.warn,
		error: console.error,
	};
	for (const method of methods) {
		console[method] = (...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		};
	}
	return {
		get text() {
			return lines.join("\n");
		},
		restore() {
			console.log = previous.log;
			console.info = previous.info;
			console.debug = previous.debug;
			console.warn = previous.warn;
			console.error = previous.error;
		},
	};
}
