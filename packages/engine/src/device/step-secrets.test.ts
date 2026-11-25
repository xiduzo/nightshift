import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { type AddressInfo, createServer } from "node:net";
import { harnessFacts } from "@nightshift/agents/harness-facts";
import type { AgentEvent } from "@nightshift/agents/types";
import type { JsonValue } from "@nightshift/flows";
import {
	connectionsOf,
	createSandbox,
	harnessesOf,
	type Sandbox,
	type TestDeviceDeps,
} from "../testing/test-support";
import { localDevice } from "./local";

/**
 * The rule of a step's secrets, through the Device port: each job reads
 * the secrets of its use, refuses when one is missing, and gives nothing
 * back that holds a value. Every value here is made up.
 */

const VALUE = "pine-4711-apple";
const MASK = "•••";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** Answers a POST with its own body, in two chunks cut inside the body. */
const echo = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	async fetch(request) {
		const body = await request.text();
		const at = body.indexOf("4711") + 2;
		return new Response(
			new ReadableStream({
				async start(controller) {
					const bytes = new TextEncoder();
					controller.enqueue(bytes.encode(body.slice(0, at)));
					await Bun.sleep(20);
					controller.enqueue(bytes.encode(body.slice(at)));
					controller.close();
				},
			}),
			{
				headers: {
					"content-type": request.headers.get("content-type") ?? "text/plain",
					"x-echo": request.headers.get("x-token") ?? "",
				},
			},
		);
	},
});
afterAll(() => {
	echo.stop(true);
});

/**
 * An MCP server on stdio whose tool `echo` answers with what TOKEN makes of
 * `template`: `text`, `structuredContent`, or a protocol error.
 */
const MCP = `
const fill = (value) => JSON.parse(JSON.stringify(value).replaceAll("TOKEN", JSON.stringify(process.env.TOKEN ?? "").slice(1, -1)));
const send = (id, body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...body }) + "\\n");
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
	buffer += new TextDecoder().decode(chunk);
	for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
		const message = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		const { id, method, params } = message;
		if (id === undefined) continue;
		if (method === "initialize") send(id, { result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } });
		else if (method === "tools/list") send(id, { result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } });
		else if (method === "tools/call") {
			const answer = fill(JSON.parse(params.arguments.template));
			if (answer.throws) send(id, { error: { code: -32000, message: answer.throws } });
			else send(id, { result: { content: [{ type: "text", text: answer.text ?? "" }], ...(answer.data ? { structuredContent: answer.data } : {}), isError: answer.isError ?? false } });
		} else send(id, { error: { code: -32601, message: "no" } });
	}
}
`;

const signal = () => new AbortController().signal;

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of stream) items.push(item);
	return items;
}

/** This computer with the secret TOKEN, which the connection "echo" reads too. */
function device(
	value: string,
	{ harnesses = {}, ...deps }: Partial<TestDeviceDeps> = {},
) {
	return localDevice({
		id: "d1",
		name: "studio",
		harnesses: harnessesOf(harnesses),
		connections: {
			...connectionsOf({ secrets: { TOKEN: value } }),
			mcpServersFor: async (node) =>
				node.connections?.includes("missing")
					? { ok: false, message: "It needs the secret NONE." }
					: {
							ok: true,
							servers: {
								echo: {
									command: process.execPath,
									args: ["-e", MCP],
									env: { TOKEN: value },
								},
							},
							values: value === "" ? [] : [value],
						},
		},
		...deps,
	});
}

/** A session whose harness sends `events`, then does `end`. */
async function session(
	events: AgentEvent[],
	options: { value?: string; end?: () => void; connections?: string[] } = {},
) {
	return collect(
		device(options.value ?? VALUE, {
			harnesses: {
				"claude-code": {
					name: "claude-code",
					...harnessFacts("claude-code"),
					async *run() {
						yield* events;
						options.end?.();
					},
				},
			},
		}).session({
			harness: "claude-code",
			cwd: sandbox.repoPath,
			prompt: "Work.",
			model: "sonnet",
			permissionMode: "acceptEdits",
			connections: options.connections ?? ["echo"],
			signal: signal(),
		}),
	);
}

async function command(
	text: string,
	options: {
		value?: string;
		secrets?: string[];
		deps?: Partial<TestDeviceDeps>;
		more?: object;
	} = {},
) {
	return collect(
		device(options.value ?? VALUE, options.deps).exec({
			command: text,
			cwd: sandbox.repoPath,
			secrets: options.secrets ?? ["TOKEN"],
			signal: signal(),
			...options.more,
		}),
	);
}

/** What a command wrote, both streams together. */
const written = (events: Awaited<ReturnType<typeof command>>) =>
	events.flatMap((e) => (e.type === "output" ? [e.text] : [])).join("");

const call = (
	template: Record<string, JsonValue>,
	options: {
		value?: string;
		connection?: string;
		tool?: string;
		more?: Record<string, JsonValue>;
	} = {},
) =>
	device(options.value ?? VALUE).callTool({
		connection: options.connection ?? "echo",
		tool: options.tool ?? "echo",
		arguments: { template: JSON.stringify(template), ...options.more },
		signal: signal(),
	});

const request = (
	before: string,
	after: string,
	options: {
		value?: string;
		secret?: string;
		json?: boolean;
		url?: string;
	} = {},
) =>
	device(options.value ?? VALUE).request({
		method: "POST",
		url: [{ text: options.url ?? String(echo.url) }],
		headers: [{ name: "x-token", value: [{ secret: "TOKEN" }] }],
		body: {
			kind: "text",
			contentType: options.json ? "application/json" : "text/plain",
			text: [
				{ text: before },
				{
					secret: options.secret ?? "TOKEN",
					...(options.json ? { escape: "json" as const } : {}),
				},
				{ text: after },
			],
		},
		timeoutMs: 5_000,
		maxBytes: 100_000,
		signal: signal(),
	});

/** A result, with the JSON of its text or output read back as a step reads it. */
function decoded(result: unknown): unknown {
	const { text, output } = (Array.isArray(result) ? result.at(-1) : result) as {
		text?: string;
		output?: string;
	};
	return JSON.parse(text ?? output ?? "");
}

/** Answers with the value in the status text. */
const statusServer = createServer((socket) => {
	socket.once("data", () =>
		socket.end(`HTTP/1.1 200 is ${VALUE}\r\ncontent-length: 0\r\n\r\n`),
	);
});
let statusPort = 0;
beforeAll(async () => {
	await new Promise<void>((resolve) =>
		statusServer.listen(0, "127.0.0.1", resolve),
	);
	statusPort = (statusServer.address() as AddressInfo).port;
});
afterAll(() => {
	statusServer.close();
});

/** The cells of the rule: what a job gives back, and that it holds the mask in place of the value. */
const CELLS: Record<string, Record<string, () => Promise<unknown>>> = {
	session: {
		"a value in the output": () =>
			session([
				{ type: "tool-result", toolCallId: "t", content: `is ${VALUE}` },
			]),
		"a value split over chunks": async () =>
			(
				await session([
					{ type: "text", messageId: "m", delta: "is pine-47" },
					{ type: "text", messageId: "m", delta: "11-apple." },
				])
			)
				.flatMap((e) => (e.type === "text" ? [e.delta] : []))
				.join(""),
		"a value in an output's data": () =>
			session([
				{ type: "report", outcome: "pass", summary: "", data: { a: [VALUE] } },
			]),
		"a value as a JSON key": () =>
			session([
				{
					type: "tool-end",
					toolCallId: "t",
					name: "Write",
					input: { deep: [{ [`x ${VALUE}`]: 1 }] },
				},
			]),
		"a value in an error": () =>
			session([{ type: "error", kind: "harness", message: `bad ${VALUE}` }]),
		"a value in an abort's error": async () => {
			const error = new DOMException(`bad ${VALUE}`, "AbortError");
			await session([], {
				end: () => {
					throw error;
				},
			}).catch(() => {});
			return error.message;
		},
		"a value in what a thrown error holds": async () => {
			const thrown = Object.assign(
				new AggregateError([new Error(`one ${VALUE}`)], "many", {
					cause: new Error("why", { cause: `deep ${VALUE}` }),
				}),
				{ stderr: `out ${VALUE}`, data: { [VALUE]: [VALUE] } },
			);
			thrown.name = `Name ${VALUE}`;
			const caught = (await session([], {
				end: () => {
					throw thrown;
				},
			}).catch((error) => error)) as typeof thrown;
			expect(caught).toBe(thrown);
			expect((caught.cause as Error).cause).toBe(`deep ${MASK}`);
			expect(caught.errors[0].message).toBe(`one ${MASK}`);
			return Bun.inspect(caught);
		},
		"a value in an error that is its own cause": async () => {
			const thrown: Error = new Error(`bad ${VALUE}`);
			thrown.cause = thrown;
			const caught = await session([], {
				end: () => {
					throw thrown;
				},
			}).catch((error) => error);
			expect(caught).toBe(thrown);
			return caught.message;
		},
		"a value in a thrown object": () =>
			session([], {
				end: () => {
					throw { message: `bad ${VALUE}` };
				},
			}).catch((error) => error),
		"a value in a frozen error": async () => {
			const thrown = Object.freeze(new TypeError(`bad ${VALUE}`));
			const caught = await session([], {
				end: () => {
					throw thrown;
				},
			}).catch((error) => error);
			expect(caught).toBeInstanceOf(TypeError);
			expect(caught.name).toBe("TypeError");
			expect(caught.message).toBe(`bad ${MASK}`);
			return Bun.inspect(caught);
		},
		"a value in a thrown error": async () => {
			try {
				await session([], {
					end: () => {
						throw new TypeError(`bad ${VALUE}`);
					},
				});
			} catch (error) {
				expect(error).toBeInstanceOf(TypeError);
				return `${error} ${(error as Error).stack}`;
			}
		},
	},
	command: {
		"a value in the output": () =>
			command('echo "is $TOKEN"; echo "$TOKEN" >&2'),
		"a value split over chunks": async () =>
			written(
				await command(
					'printf "is pine-47"; sleep 0.2; printf "11-apple."; sleep 0.2; printf ok',
				),
			),
		"a value in an output's data": () =>
			command('printf \'{"a":"%s"}\' "$TOKEN" > "$NS_OUTPUT"', {
				more: { outputFile: true },
			}),
		"a value that the output writes with other escapes": () =>
			command(`printf '%s' '{"a":"pine-\\u0034711-apple"}' > "$NS_OUTPUT"`, {
				more: { outputFile: true },
			}).then(decoded),
		"a value as a JSON key": () =>
			command('printf \'{"%s":1}\' "$TOKEN" > "$NS_OUTPUT"', {
				more: { outputFile: true },
			}),
		"a value in an error": () => command(`echo \0${VALUE}`),
		"a value in the name of a file it could not keep": () =>
			command('printf x > "$NS_ARTIFACTS/$TOKEN.txt"', {
				deps: {
					artifacts: {
						save: async () => {
							throw new Error("No space");
						},
						answerFolder: async () => null,
					} as never,
				},
				more: { artifacts: { runId: "r", stepId: "s" } },
			}),
		"a value in why a tool it names could not run": () =>
			command("echo gh; exit 1", {
				deps: {
					toolLaunchers: {
						prepare: async () => ({ ok: false, message: "unused" }),
						forCommand: async () => ({
							toolsPath: null,
							leftOut: [{ tool: "gh", message: `bad ${VALUE}` }],
							env: {},
							values: [],
							cleanup: async () => {},
						}),
						guarded: () => [],
					},
				},
			}),
		"a value of the page reader's key": () =>
			command(`printf '%s' "${VALUE}"`, {
				secrets: [],
				deps: {
					knowledge: {
						forCommand: async (
							_id: string,
							step: { secret: (name: string) => Promise<string | undefined> },
						) => {
							expect(await step.secret("TOKEN")).toBe(VALUE);
							return { env: {}, done: async () => {} };
						},
					} as never,
				},
				more: { knowledge: { projectId: "p" } },
			}),
	},
	"tool call": {
		"a value in the output": () => call({ text: "is TOKEN" }),
		"a value in an output's data": () => call({ data: { a: ["TOKEN"] } }),
		"a value as a JSON key": () => call({ data: { deep: [{ TOKEN: 1 }] } }),
		"a value in JSON text": () => call({ text: '[{"a":"TOKEN"}]' }),
		"a value that JSON text writes with other escapes": () =>
			call({ text: String.raw`{"a":"pine-\u0034711-apple"}` }).then(decoded),
		"a value that a JSON string writes with other escapes": () =>
			call({ text: String.raw`"pine-\u0034711-apple"` }).then(decoded),
		"a value in a tool's error": () =>
			call({ text: "bad TOKEN", isError: true }),
		"a value in a server's error": () => call({ throws: "bad TOKEN" }),
		"a value in the arguments": () =>
			call({ text: "ok" }, { more: { a: VALUE } }),
		"a value in the arguments of a call that failed": () =>
			call({ throws: "bad" }, { more: { a: VALUE } }),
		"a value in the arguments of a call that was not made": async () => {
			const result = await call({}, { tool: "nope", more: { a: VALUE } });
			expect(result).toMatchObject({ kind: "failed", arguments: null });
			return result;
		},
		"a value in the name of a tool it does not have": () =>
			call({}, { tool: VALUE }),
	},
	request: {
		"a value in the status text": () =>
			request("", "", { url: `http://127.0.0.1:${statusPort}/` }),
		"a value in the output": () => request("is ", "."),
		"a value split over chunks": () => request("is ", "."),
		"a value in an output's data": () =>
			request('{"a":["', '"]}', { json: true }),
		"a value as a JSON key": () =>
			request('{"deep":[{"', '":1}]}', { json: true }),
		"a value in an error": () => request("", "", { url: `not a URL ${VALUE}` }),
	},
};

describe("every job hides the secrets of its use", () => {
	for (const [job, cells] of Object.entries(CELLS)) {
		for (const [cell, run] of Object.entries(cells)) {
			test(`${job}: ${cell}`, async () => {
				const out = JSON.stringify(await run());
				expect(out).toContain(MASK);
				expect(out).not.toContain(VALUE);
			});
		}
	}
});

describe("every job refuses when a secret is missing", () => {
	test("session", async () => {
		expect(await session([], { connections: ["missing"] })).toEqual([
			{ type: "refused", message: "It needs the secret NONE." },
		]);
	});

	test("command", async () => {
		expect(await command("true", { secrets: ["NONE"] })).toEqual([
			{
				type: "refused",
				message:
					"The command needs the secret NONE, but it is not saved. Save it on the Secrets page, or remove it from the node.",
			},
		]);
	});

	test("tool call", async () => {
		expect(await call({}, { connection: "missing" })).toEqual({
			kind: "refused",
			message: "It needs the secret NONE.",
		});
	});

	test("request", async () => {
		expect(await request("", "", { secret: "NONE" })).toEqual({
			kind: "refused",
			message:
				"The request needs the secret NONE, but it is not saved. Save it on the Secrets page, or remove it from the node.",
		});
	});
});

describe("a short value is hidden as a long one is, and an empty one hides nothing", () => {
	for (const [value, shown] of [
		["qz", "a ••• b"],
		["", "a  b"],
	] as const) {
		test(`"${value}"`, async () => {
			const text = `a ${value} b`;
			const inSession = await session(
				[{ type: "tool-result", toolCallId: "t", content: text }],
				{ value },
			);
			expect(inSession.at(-1)).toMatchObject({ content: shown });
			expect(
				written(await command('printf "a %s b" "$TOKEN"', { value })),
			).toBe(shown);
			expect(await call({ text: "a TOKEN b" }, { value })).toMatchObject({
				text: shown,
			});
			expect(await request("a ", " b", { value })).toMatchObject({
				response: { body: shown },
			});
		});
	}
});

describe("what a later step reads keeps its shape", () => {
	test("JSON text of a tool stays JSON when a number has the digits of a value", async () => {
		expect(
			await call({ text: '[{"n": 4711, "of": "TOKEN"}]' }, { value: "4711" }),
		).toMatchObject({ text: '[{"n":4711,"of":"•••"}]' });
	});

	test("a tool's text that is the value alone is hidden, digits too", async () => {
		expect(await call({ text: "TOKEN" }, { value: "4711" })).toMatchObject({
			text: MASK,
		});
	});

	test("a header keeps its name when a value is in it", async () => {
		const result = await request("", "", { value: "x-echo" });
		expect(result).toMatchObject({
			kind: "answered",
			response: { headers: { "x-echo": MASK } },
		});
	});

	test("JSON text keeps its layout when the values go out of it as they are", async () => {
		expect(
			await call({ text: '[ {"n": 1.0,\t"of": "TOKEN"} ]' }),
		).toMatchObject({ text: '[ {"n": 1.0,\t"of": "•••"} ]' });
	});

	test("text that is not valid JSON hides the value as plain text", async () => {
		expect(
			await call({ text: '{"n": 4711, "of": "TOKEN"' }, { value: "4711" }),
		).toMatchObject({ text: '{"n": •••, "of": "•••"' });
	});

	test("a number in JSON text that is written again reads as it does in data", async () => {
		expect(
			await call({
				text: String.raw`{"big":12345678901234567890,"of":"pine-\u0034711-apple"}`,
			}),
		).toMatchObject({
			text: `{"big":12345678901234567000,"of":"•••"}`,
		});
	});

	test("a number of a command's output that has the digits of a value is hidden", async () => {
		const events = await command('printf \'{"n": 4711}\' > "$NS_OUTPUT"', {
			value: "4711",
			more: { outputFile: true },
		});
		expect(events.at(-1)).toMatchObject({ output: '{"n":•••}' });
	});

	test("a value that runs over the parts of a JSON text is hidden in it", async () => {
		const value = 'left-part","right-part';
		const result = await call(
			{ text: '["left-part","right-part",1]' },
			{ value },
		);
		expect(result).toMatchObject({ text: '["•••",1]' });
		expect(
			await call(
				{ text: '["left-part","right-part"]' },
				{ value: `${value}"]` },
			),
		).toMatchObject({ text: '["•••' });
	});

	test("an event keeps its own fields, and the data of a report its names", async () => {
		const report: AgentEvent = {
			type: "report",
			outcome: "",
			summary: "ok",
			data: { data: 1 },
		};
		const usage = { inputTokens: 1, outputTokens: 2, costUsd: 0 };
		expect(
			(
				await session([report, { type: "finished", usage }], { value: "ata" })
			).slice(1),
		).toEqual([report, { type: "finished", usage }]);
		expect(
			(await session([{ type: "finished", usage }], { value: "Tokens" })).at(
				-1,
			),
		).toEqual({ type: "finished", usage });
	});
});

describe("a value that is a JSON document is hidden as a whole, however it is written", () => {
	const document = { user: "fern", key: { id: "k-77", words: ["oak", "elm"] } };
	const value = JSON.stringify(document);
	const other = {
		key: { words: ["oak", "elm"], id: "k-77" },
		user: "fern",
	};

	test("in a tool's text", async () => {
		expect(
			await call({ text: JSON.stringify({ c: other, n: 1 }) }, { value }),
		).toMatchObject({ text: '{"c":"•••","n":1}' });
		expect(
			await call({ text: JSON.stringify(other) }, { value }),
		).toMatchObject({ text: '"•••"' });
	});

	test("in a tool's data and arguments", async () => {
		expect(
			await call({ data: { c: [other] } }, { value, more: { a: other } }),
		).toMatchObject({
			structuredContent: { c: [MASK] },
			arguments: { a: MASK },
		});
		// Data is an object or nothing.
		expect(await call({ data: other }, { value })).toMatchObject({
			structuredContent: null,
		});
	});

	test("as the arguments of a call, which are an object then too", async () => {
		const whole = { template: JSON.stringify({ text: "ok" }) };
		expect(
			await device(JSON.stringify(whole)).callTool({
				connection: "echo",
				tool: "echo",
				arguments: whole,
				signal: signal(),
			}),
		).toMatchObject({ kind: "called", arguments: {} });
		expect(
			await device(JSON.stringify(whole)).callTool({
				connection: "echo",
				tool: "nope",
				arguments: whole,
				signal: signal(),
			}),
		).toMatchObject({ kind: "failed", asked: {} });
	});

	test("in a web request's body and a command's output", async () => {
		expect(
			await request(`{"c":${JSON.stringify(other)},"of":"`, '"}', {
				value,
				json: true,
			}),
		).toMatchObject({ response: { body: { c: MASK, of: MASK } } });
		const events = await command(
			`printf '%s' '${JSON.stringify({ c: other })}' > "$NS_OUTPUT"`,
			{ value, more: { outputFile: true } },
		);
		expect(events.at(-1)).toMatchObject({ output: '{"c":"•••"}' });
	});

	test("in a session's tool input", async () => {
		expect(
			(
				await session(
					[
						{
							type: "tool-end",
							toolCallId: "t",
							name: "W",
							input: { c: other },
						},
					],
					{ value },
				)
			).at(-1),
		).toMatchObject({ input: { c: MASK } });
	});

	test("an empty document hides nothing but its own text", async () => {
		expect(
			await call({ data: { a: {}, b: [] } }, { value: "{}" }),
		).toMatchObject({ structuredContent: { a: {}, b: [] } });
	});
});
