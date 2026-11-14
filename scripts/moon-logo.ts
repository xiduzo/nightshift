/**
 * Writes the moon of now to `<folder>/moon.svg`, for the logo of the README.
 * `.github/workflows/moon.yml` runs it each day and keeps the file on the
 * `moon` branch. It copies the icon of `bun run icons` for the phase of now.
 *
 *   bun scripts/moon-logo.ts <folder>
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { moonPhase } from "@nightshift/time";

const folder = Bun.argv[2];
if (!folder) throw new Error("Give the folder to write moon.svg to.");
const phase = moonPhase();
mkdirSync(folder, { recursive: true });
copyFileSync(
	join(import.meta.dir, `../apps/web/public/moon/${phase}.svg`),
	join(folder, "moon.svg"),
);
console.log(`Phase ${phase}: ${join(folder, "moon.svg")}`);
