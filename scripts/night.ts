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
 * Ctrl+C stops both. When one process ends, the other is stopped too.
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

const children = [
	{
		name: "server",
		proc: Bun.spawn(["bun", "src/index.ts"], {
			cwd: join(root, "apps", "server"),
			env,
			stdout: "inherit",
			stderr: "inherit",
		}),
	},
	{
		name: "web",
		proc: Bun.spawn(
			["bun", "run", "serve", "--port", webPort, "--strictPort"],
			{
				cwd: join(root, "apps", "web"),
				env,
				stdout: "inherit",
				stderr: "inherit",
			},
		),
	},
];
log(
	`server pid ${children[0]?.proc.pid} on :${port}, web pid ${children[1]?.proc.pid} on :${webPort}`,
);

let stopping = false;
function stopAll(signal: NodeJS.Signals = "SIGTERM") {
	if (stopping) return;
	stopping = true;
	for (const { proc } of children) {
		if (proc.exitCode === null) proc.kill(signal);
	}
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.on(signal, () => stopAll(signal));
}

const first = await Promise.race(
	children.map(async ({ name, proc }) => ({ name, code: await proc.exited })),
);
const bySignal = stopping;
if (!bySignal) log(`${first.name} exited (code ${first.code}); stopping.`);
stopAll();
await Promise.all(children.map(({ proc }) => proc.exited));
process.exit(bySignal ? 0 : first.code || 1);
