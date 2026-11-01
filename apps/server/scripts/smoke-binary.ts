/**
 * Starts the built `nightshift` binary as the Docker image does, and checks
 * that it works: `serve` answers, `health` sees it, and pi-acp (which the
 * binary carries inside) answers over ACP. It catches a binary that stops at
 * start, for example on a package it cannot find at run time.
 *
 *   bun scripts/smoke-binary.ts                 # dist/bin/nightshift-<this platform>
 *   bun scripts/smoke-binary.ts path/to/nightshift
 *
 * Each check runs in a new temporary folder (data, home and working
 * folder), never in your own data folder. Exit code 0 when all pass.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { now } from "@nightshift/time";

const START_TIMEOUT_MS = 60_000;

const binary = resolve(
	process.argv[2] ??
		join(
			import.meta.dir,
			`../dist/bin/nightshift-${process.platform}-${process.arch}`,
		),
);
if (!(await Bun.file(binary).exists())) {
	console.error(`There is no binary at ${binary}. Run build:binary first.`);
	process.exit(1);
}

/** A port that nothing listens on now. */
function freePort(): number {
	const server = Bun.serve({ port: 0, fetch: () => new Response() });
	const port = server.port as number;
	server.stop(true);
	return port;
}

const temp = mkdtempSync(join(tmpdir(), "nightshift-smoke-"));
const port = freePort();
// Only what the Docker image sets, plus a Host address as in production.
// No node_modules near the working folder: the binary must not need them.
const env: Record<string, string> = {
	PATH: process.env.PATH ?? "/usr/bin:/bin",
	HOME: join(temp, "home"),
	NIGHTSHIFT_DATA_DIR: join(temp, "data"),
	PORT: String(port),
	NIGHTSHIFT_HOST: "on",
	NIGHTSHIFT_HOST_ADDRESSES: "https://nightshift.example.com",
	NIGHTSHIFT_LISTEN: "127.0.0.1",
	NIGHTSHIFT_SCHEDULER: "off",
};

let output = "";
const serve = Bun.spawn([binary, "serve"], {
	cwd: temp,
	env,
	stdout: "pipe",
	stderr: "pipe",
});
for (const stream of [serve.stdout, serve.stderr]) {
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) {
			const text = decoder.decode(chunk, { stream: true });
			output += text;
			process.stdout.write(text);
		}
	})();
}

function fail(message: string): never {
	console.error(`\nFAIL: ${message}`);
	serve.kill("SIGKILL");
	rmSync(temp, { recursive: true, force: true });
	process.exit(1);
}

async function waitForAnswer(): Promise<string> {
	const deadline = now() + START_TIMEOUT_MS;
	while (now() < deadline) {
		const match = /Night Shift answers at (\S+)/.exec(output);
		if (match?.[1]) return match[1];
		if (serve.exitCode !== null) {
			fail(
				`serve stopped with exit code ${serve.exitCode} before it answered.`,
			);
		}
		await Bun.sleep(100);
	}
	fail(`serve did not answer within ${START_TIMEOUT_MS / 1000} s.`);
}

/** One ACP request to `nightshift pi-acp`: its first line must be the answer. */
async function piAcpAnswers(): Promise<void> {
	const piAcp = Bun.spawn([binary, "pi-acp"], {
		cwd: temp,
		env: { ...env, PI_ACP_PI_COMMAND: "pi" },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	piAcp.stdin.write(
		`${JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 1, clientCapabilities: {} },
		})}\n`,
	);
	await piAcp.stdin.flush();
	const timer = setTimeout(() => piAcp.kill("SIGKILL"), 15_000);
	let text = "";
	const decoder = new TextDecoder();
	for await (const chunk of piAcp.stdout) {
		text += decoder.decode(chunk, { stream: true });
		if (text.includes("\n")) break;
	}
	clearTimeout(timer);
	piAcp.kill();
	const line = text.split("\n")[0] ?? "";
	let answer: { id?: number; result?: { agentInfo?: { name?: string } } };
	try {
		answer = JSON.parse(line);
	} catch {
		const stderr = await new Response(piAcp.stderr).text();
		fail(`pi-acp did not answer over ACP. stdout: ${line}\nstderr: ${stderr}`);
	}
	if (answer.id !== 1 || answer.result?.agentInfo?.name !== "pi-acp") {
		fail(`pi-acp answered something else: ${line}`);
	}
}

const url = await waitForAnswer();
const page = await fetch(url);
if (page.status !== 200) fail(`GET ${url} answered ${page.status}, not 200.`);
console.log(`\nOK: GET ${url} answers 200.`);

const health = Bun.spawnSync([binary, "health"], { cwd: temp, env });
process.stdout.write(health.stdout);
if (health.exitCode !== 0) {
	fail(`health exited with ${health.exitCode}: ${health.stderr.toString()}`);
}
console.log("OK: health exits with 0.");

await piAcpAnswers();
console.log("OK: pi-acp answers over ACP.");

serve.kill("SIGTERM");
const stopped = await Promise.race([serve.exited, Bun.sleep(15_000)]);
if (stopped === undefined) fail("serve did not stop within 15 s of SIGTERM.");
rmSync(temp, { recursive: true, force: true });
console.log("OK: serve stopped. The binary works.");
