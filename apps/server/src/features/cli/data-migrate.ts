/**
 * `bun run data:migrate [--dev]`: copies the run history from where Night
 * Shift kept it before the data directory into the data directory. It
 * copies and never moves, so the old files stay until you delete them.
 *
 * - The database: the file `DATABASE_URL` names, else the checkout's
 *   `local.db`. `VACUUM INTO` writes a consistent copy, also of a database
 *   in WAL mode. A remote `DATABASE_URL` is not copied.
 * - `~/.nightshift/transcripts` and `~/.nightshift/logs`.
 * - `--dev` fills the dev data directory (`bun run dev`) instead.
 *
 * It refuses when the data directory already holds a database, transcripts
 * or logs. Stop the daemon first: a run that writes during the copy is cut.
 */
import { cpSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { createDb } from "@nightshift/db";
import {
	checkoutRoot,
	DATABASE_FILE,
	ensureDataDir,
	resolveDataDir,
} from "@nightshift/db/data-dir";

import "varlock/auto-load";

import { ENV } from "../../env";

const dev = process.argv.includes("--dev");
// ENV is a proxy: read its fields, do not spread it.
const dataDir = resolveDataDir({
	NIGHTSHIFT_DATA_DIR: ENV.NIGHTSHIFT_DATA_DIR,
	NIGHTSHIFT_DEV: dev || ENV.NIGHTSHIFT_DEV === "true",
});
const target = join(dataDir, DATABASE_FILE);
const oldDir = join(homedir(), ".nightshift");

const hasEntries = (dir: string) =>
	existsSync(dir) && readdirSync(dir).length > 0;

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

const url = ENV.DATABASE_URL?.trim();
let source: string | null = join(checkoutRoot, "local.db");
if (url) {
	source = url.startsWith("file:") ? resolve(url.slice("file:".length)) : null;
	if (!source)
		console.log(
			`DATABASE_URL is not a file (${url}): the database stays there.`,
		);
}
if (source && !existsSync(source)) source = null;
if (source && resolve(source) === resolve(target)) source = null;

const folders = ["transcripts", "logs"]
	.map((name) => ({ from: join(oldDir, name), to: join(dataDir, name) }))
	.filter(({ from, to }) => hasEntries(from) && resolve(from) !== resolve(to));

if (!source && folders.length === 0) {
	console.log(`Nothing to copy. The data directory is ${dataDir}.`);
	process.exit(0);
}
if (source && existsSync(target)) {
	fail(
		`${target} exists already. Nothing was copied. Remove it first, or set NIGHTSHIFT_DATA_DIR to an empty folder.`,
	);
}
for (const { to } of folders) {
	if (hasEntries(to)) {
		fail(`${to} is not empty. Nothing was copied.`);
	}
}

ensureDataDir(dataDir);
if (source) {
	const db = createDb({ DATABASE_URL: `file:${source}` });
	await db.$client.execute({ sql: "VACUUM INTO ?", args: [target] });
	db.$client.close();
	console.log(`Copied the database ${source} to ${target}.`);
}
for (const { from, to } of folders) {
	cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
	console.log(`Copied ${from} to ${to}.`);
}
if (url?.startsWith("file:")) {
	console.log(
		"Remove DATABASE_URL from apps/server/.env, so the daemon opens the copy.",
	);
}
console.log(
	"The old files stay. Delete them when the daemon runs well on the copy.",
);
