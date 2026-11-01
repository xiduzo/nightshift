import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { now } from "@nightshift/time";
import type { Device } from "../device";
import { spawnCommand } from "../device/command";
import type { ServiceHold, ServiceSpec } from "../log";
import { createServiceKeeper, type ServiceKeeper } from "./keeper";

/**
 * The service keeper with real processes: a small Bun web server that
 * runs in the background, a probe that waits for it, and the stops. A
 * second lasts 20 ms here, so `timeoutMinutes: 1` is 1.2 s.
 */

const SECOND_MS = 20;
const BUN = process.execPath;

/** This computer as a Device that only runs commands. */
const device = {
	id: "this",
	name: "This computer",
	exec: (input: Parameters<Device["exec"]>[0]) => spawnCommand(input),
} as unknown as Device;

let dir: string;
let keepers: ServiceKeeper[];
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "nightshift-service-"));
	writeFileSync(join(dir, "server.ts"), SERVER);
	keepers = [];
});
afterEach(async () => {
	rmSync(dir, { recursive: true, force: true });
});

/**
 * Listens on `$PORT` (0: any free port), writes the port to `port` and
 * says so on stdout. Stops on SIGTERM and writes `stopped` then.
 */
const SERVER = `
const server = Bun.serve({ port: Number(process.env.PORT ?? 0), hostname: "127.0.0.1", fetch: () => new Response("ok") });
require("node:fs").writeFileSync("port", String(server.port));
console.log("listening on " + server.port);
process.on("SIGTERM", () => { require("node:fs").writeFileSync("stopped", "yes"); process.exit(0); });
setInterval(() => {}, 1000);
`;

/** Ready when the server answers; writes its address to `$NS_OUTPUT`. */
const READY_COMMAND = `"${BUN}" -e 'const p = require("node:fs").readFileSync("port", "utf8"); const r = await fetch("http://127.0.0.1:" + p); if (!r.ok) process.exit(1); require("node:fs").writeFileSync(process.env.NS_OUTPUT, JSON.stringify({ url: "http://127.0.0.1:" + p }));'`;

function keeper(): ServiceKeeper {
	const made = createServiceKeeper({ now: now, secondMs: SECOND_MS });
	keepers.push(made);
	return made;
}

const spec = (extra: Partial<ServiceSpec> = {}): ServiceSpec => ({
	start: `"${BUN}" server.ts`,
	ready: { command: READY_COMMAND },
	everySeconds: 2,
	timeoutMinutes: 1,
	stop: null,
	env: {},
	...extra,
});

/** A free port on this computer, for a server that listens on a known one. */
function freePort(): number {
	const probe = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: () => new Response(),
	});
	const { port } = probe;
	probe.stop(true);
	return port as number;
}

async function answers(url: string): Promise<boolean> {
	try {
		return (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
	} catch {
		return false;
	}
}

type Started = { pid: number | null; startedAt: string | null };

function bringUp(
	services: ServiceKeeper,
	service: ServiceSpec,
	extra: { signal?: AbortSignal; here?: boolean; nodeId?: string } = {},
) {
	const started: Started[] = [];
	const logPath = join(dir, "logs", `${extra.nodeId ?? "stack"}.log`);
	const result = services.bringUp({
		runId: "run-1",
		nodeId: extra.nodeId ?? "stack",
		scope: null,
		device,
		here: extra.here ?? true,
		cwd: dir,
		spec: service,
		logPath,
		signal: extra.signal ?? new AbortController().signal,
		onStarted: async (at) => {
			started.push(at);
		},
	});
	return { result, started, logPath };
}

const hold = (
	service: ServiceSpec,
	at: Started,
	logPath: string,
): ServiceHold => ({
	kind: "service",
	nodeId: "stack",
	scope: null,
	section: null,
	deviceId: device.id,
	cwd: dir,
	logPath,
	pid: at.pid,
	startedAt: at.startedAt,
	spec: service,
	at: 0,
});

describe("bringUp", () => {
	test("given a server that starts, when its ready command answers, then the service is ready with the command's data and its log", async () => {
		const services = keeper();
		const { result, started, logPath } = bringUp(services, spec());

		const up = await result;

		expect(up.kind).toBe("ready");
		const port = readFileSync(join(dir, "port"), "utf8");
		expect(up).toMatchObject({ data: { url: `http://127.0.0.1:${port}` } });
		expect(up.logTail).toContain(`listening on ${port}`);
		expect(started).toHaveLength(1);
		expect(started[0]?.pid).toBeGreaterThan(0);
		expect(started[0]?.startedAt).not.toBeNull();
		expect(await answers(`http://127.0.0.1:${port}`)).toBe(true);

		await services.stop("run-1", [
			{ service: hold(spec(), started[0] as Started, logPath), device },
		]);
		expect(await answers(`http://127.0.0.1:${port}`)).toBe(false);
	});

	test("given a URL probe, when the address answers, then the service is ready", async () => {
		const port = freePort();
		const services = keeper();
		const service = spec({
			ready: { url: `http://127.0.0.1:${port}/` },
			env: { PORT: String(port) },
		});
		const { result, started, logPath } = bringUp(services, service);

		expect((await result).kind).toBe("ready");

		await services.stop("run-1", [
			{ service: hold(service, started[0] as Started, logPath), device },
		]);
		expect(await answers(`http://127.0.0.1:${port}/`)).toBe(false);
	});

	test("given a start command that fails, when it ends before it is ready, then the service failed with the exit code", async () => {
		const { result } = bringUp(
			keeper(),
			spec({ start: "echo broken >&2; exit 3" }),
		);

		const up = await result;

		expect(up).toMatchObject({
			kind: "failed",
			reason: "The service ended with code 3 before it was ready.",
		});
		expect(up.logTail).toContain("broken");
	});

	test("given a start command that exits 0, when the probe then says ready, then the service is ready", async () => {
		const { result } = bringUp(
			keeper(),
			spec({ start: "echo up > marker", ready: { command: "test -f marker" } }),
		);

		expect((await result).kind).toBe("ready");
	});

	test("given a probe that never says ready, when the time runs out, then the service failed and its process stopped", async () => {
		const services = keeper();
		const { result } = bringUp(
			services,
			spec({ ready: { command: "echo not yet; exit 1" } }),
		);

		const up = await result;

		expect(up.kind).toBe("failed");
		expect(up).toMatchObject({
			reason:
				"The service was not ready after 1 minute. The last check ended with code 1: not yet",
		});
		const port = readFileSync(join(dir, "port"), "utf8");
		expect(await answers(`http://127.0.0.1:${port}`)).toBe(false);
	});

	test("given a stop of the run, when the service is not ready yet, then it ends aborted and its process stops", async () => {
		const stop = new AbortController();
		const services = keeper();
		const { result, started } = bringUp(
			services,
			spec({ ready: { command: "exit 1" } }),
			{ signal: stop.signal },
		);
		while (!existsSync(join(dir, "port"))) await Bun.sleep(10);
		await Bun.sleep(50);
		stop.abort();

		expect((await result).kind).toBe("aborted");
		expect(started).toHaveLength(1);
		expect(existsSync(join(dir, "stopped"))).toBe(true);
	});
});

describe("stop", () => {
	test("given a stop command, when the service stops, then the command runs first and the process group ends", async () => {
		const services = keeper();
		const service = spec({ stop: "echo bye; touch stop-ran" });
		const { result, started, logPath } = bringUp(services, service);
		await result;
		const port = readFileSync(join(dir, "port"), "utf8");

		await services.stop("run-1", [
			{ service: hold(service, started[0] as Started, logPath), device },
		]);

		expect(existsSync(join(dir, "stop-ran"))).toBe(true);
		expect(readFileSync(logPath, "utf8")).toContain("bye");
		expect(await answers(`http://127.0.0.1:${port}`)).toBe(false);
	});

	test("given a service another keeper started, when it stops, then it ends the process group by its id", async () => {
		const { result, started, logPath } = bringUp(keeper(), spec());
		await result;
		const port = readFileSync(join(dir, "port"), "utf8");

		// The daemon restarted: this keeper knows the service from the log only.
		await keeper().stop("run-1", [
			{ service: hold(spec(), started[0] as Started, logPath), device },
		]);

		expect(await answers(`http://127.0.0.1:${port}`)).toBe(false);
		expect(existsSync(join(dir, "stopped"))).toBe(true);
	});

	test("given a process id that another process has now, when the service stops, then that process is left alone", async () => {
		const services = keeper();
		const { result, started, logPath } = bringUp(services, spec());
		await result;
		const port = readFileSync(join(dir, "port"), "utf8");
		const at = started[0] as Started;

		await keeper().stop("run-1", [
			{
				service: hold(
					spec(),
					{ ...at, startedAt: "Thu Jan  1 00:00:00 1970" },
					logPath,
				),
				device,
			},
		]);

		expect(await answers(`http://127.0.0.1:${port}`)).toBe(true);
		await services.stop("run-1", [
			{ service: hold(spec(), at, logPath), device },
		]);
	});
});
