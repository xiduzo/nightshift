import { stat } from "node:fs/promises";
import type { Workplaces } from "../../application/ports";

/** The folders runs work in, on this computer's disk. A path that cannot be read is no folder. */
export function fsWorkplaces(): Workplaces {
	return {
		async there(path) {
			const found = await stat(path).catch(() => null);
			return found?.isDirectory() ?? false;
		},
	};
}
