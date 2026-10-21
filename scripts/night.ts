/**
 * `bun run night`: the stable daemon for a night. It builds the web app,
 * then serves the API server and the built web app, with no hot reload and
 * no file watcher. Edits to the source tree never restart a running night:
 * develop in a separate git worktree with `bun run dev`.
 *
 * - The server runs from source with plain `bun` (no `--hot`): Bun loads the
 *   module graph once, at start. A bundle would lose the db migrations
 *   folder, which `@nightshift/db` finds next to its source.
 * - The web app is a production build served by `vite preview`.
 * - Env comes from the same varlock files as `bun run dev` (apps/server/.env,
 *   apps/web/.env). `process.env` wins over them.
 * - PORT (default 3000) and WEB_PORT (default 3001) set the ports. When one
 *   is set, the URLs that name it (BETTER_AUTH_URL, VITE_SERVER_URL,
 *   CORS_ORIGIN) follow, unless they are set too.
 *
 * Ctrl+C stops both. When one process ends, the other is stopped too. A
 * server that stops responding is restarted (the watchdog, below).
 */
import { join } from "node:path";

const root = join(import.meta.dir, "..");
// `bun run night` does not run through turbo: no turbo env to declare.
const { PORT, WEB_PORT } = process.env;
const port = PORT ?? "3000";
const webPort = WEB_PORT ?? "3001";

const env: Record<string, string | undefined> = { ...process.env, PORT: port };
if (PORT) {
	env.BETTER_AUTH_URL ??= `http://localhost:${port}`;
	env.VITE_SERVER_URL ??= `http://localhost:${port}`;
}
if (WEB_PORT) {
	env.CORS_ORIGIN ??= `http://localhost:${webPort}`;
}

function log(message: string) {
	console.log(`[night] ${message}`);
}

log("building the web app…");
const build = Bun.spawnSync(["bun", "run", "build"], {
	cwd: join(root, "apps", "web"),
	env,
	stdout: "inherit",
	stderr: "inherit",
});
if (build.exitCode !== 0) {
	log(`the web build failed (exit ${build.exitCode}).`);
	process.exit(build.exitCode ?? 1);
}

function spawnServer() {
	return Bun.spawn(["bun", "src/main.ts"], {
		cwd: join(root, "apps", "server"),
		env,
		stdout: "inherit",
		stderr: "inherit",
	});
}

let server = spawnServer();
const web = Bun.spawn(
	["bun", "run", "serve", "--port", webPort, "--strictPort"],
	{
		cwd: join(root, "apps", "web"),
		env,
		stdout: "inherit",
		stderr: "inherit",
	},
);
log(`server pid ${server.pid} on :${port}, web pid ${web.pid} on :${webPort}`);

/** The first process that ends, except a server the watchdog restarted. */
const ended = Promise.withResolvers<{ name: string; code: number }>();
const restarted = new Set<Bun.Subprocess>();
function watch(name: string, proc: Bun.Subprocess) {
	void proc.exited.then((code) => {
		if (!restarted.has(proc)) ended.resolve({ name, code });
	});
}
watch("server", server);
watch("web", web);

/*
 * The watchdog. The server can stop responding while it still answers
 * HTTP: its timers stop (a Bun bug), or it hangs. Its /health then answers
 * 503, or nothing. After two failed checks in a row, the server is stopped
 * (SIGTERM, then SIGKILL) and started again; it picks up its runs. This
 * script's timers run in this process: they go on whatever the server does.
 */
const CHECK_EVERY_MS = 15_000;
/** A server that just started sets up its database first. */
const START_GRACE_MS = 60_000;
const KILL_AFTER_MS = 5_000;
const healthUrl = `${env.NIGHTSHIFT_TLS_CERT ? "https" : "http"}://127.0.0.1:${port}/health`;
let startedAt = Date.now();
let failures = 0;
let restarting = false;
let stopping = false;

async function healthy(): Promise<boolean> {
	try {
		const response = await fetch(healthUrl, {
			signal: AbortSignal.timeout(5_000),
			// The server's own certificate may be one this computer does not trust.
			tls: { rejectUnauthorized: false },
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function restartServer() {
	restarting = true;
	const old = server;
	restarted.add(old);
	log(`the server (pid ${old.pid}) does not respond; restarting it.`);
	old.kill("SIGTERM");
	const exited = await Promise.race([
		old.exited.then(() => true),
		Bun.sleep(KILL_AFTER_MS).then(() => false),
	]);
	if (!exited) {
		old.kill("SIGKILL");
		await old.exited;
	}
	if (!stopping) {
		server = spawnServer();
		watch("server", server);
		startedAt = Date.now();
		log(`server pid ${server.pid} on :${port}`);
	}
	restarting = false;
}

const watchdog = setInterval(async () => {
	if (stopping || restarting || Date.now() - startedAt < START_GRACE_MS) {
		return;
	}
	failures = (await healthy()) ? 0 : failures + 1;
	if (failures < 2 || stopping || restarting) return;
	failures = 0;
	await restartServer();
}, CHECK_EVERY_MS);

function stopAll(signal: NodeJS.Signals = "SIGTERM") {
	if (stopping) return;
	stopping = true;
	clearInterval(watchdog);
	for (const proc of [server, web]) {
		if (proc.exitCode === null) proc.kill(signal);
	}
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.on(signal, () => stopAll(signal));
}

const first = await ended.promise;
const bySignal = stopping;
if (!bySignal) log(`${first.name} exited (code ${first.code}); stopping.`);
stopAll();
await Promise.all([server.exited, web.exited]);
process.exit(bySignal ? 0 : first.code || 1);
