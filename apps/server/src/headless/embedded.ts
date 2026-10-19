import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * What the `nightshift` binary carries inside it: the web UI and the
 * database migrations. The build (`scripts/build-binary.ts`) generates an
 * entry that embeds each file and calls `setEmbedded` before the CLI
 * starts. Night Shift run from source embeds nothing: the migrations are
 * read from `packages/db`, and the web UI comes from its dev server.
 */
export type Embedded = {
	/** URL path (`/index.html`, `/assets/…`) → the embedded file. */
	web: Record<string, string>;
	/** Path in the migrations folder (`<name>/migration.sql`) → the embedded file. */
	migrations: Record<string, string>;
};

const state = globalThis as {
	nightshiftEmbedded?: Embedded;
	nightshiftMigrations?: string;
};

export function setEmbedded(files: Embedded): void {
	state.nightshiftEmbedded = files;
}

export function embedded(): Embedded | null {
	return state.nightshiftEmbedded ?? null;
}

/**
 * Writes the embedded migrations to `dir` (emptied first), where drizzle's
 * migrator reads them, and remembers the folder for `migrationsFolder`.
 */
export async function extractMigrations(
	files: Embedded["migrations"],
	dir: string,
): Promise<string> {
	rmSync(dir, { recursive: true, force: true });
	for (const [path, file] of Object.entries(files)) {
		const target = join(dir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, await Bun.file(file).bytes());
	}
	state.nightshiftMigrations = dir;
	return dir;
}

/** The migrations folder of the binary, once extracted. Undefined: the default, from source. */
export function migrationsFolder(): string | undefined {
	return state.nightshiftMigrations;
}
