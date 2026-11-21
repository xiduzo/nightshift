import { copyFile, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ViewCopies } from "../../application/ports";
import { scanFolder } from "./fs-knowledge-folders";

/** The views of the steps on the disk: each a new folder in the temporary folder of this computer. */
export function fsViewCopies(): ViewCopies {
	return {
		make: () => mkdtemp(join(tmpdir(), "nightshift-knowledge-")),
		async copy(source, view, file) {
			const parts = file.path.split("/");
			const to = join(view, ...parts);
			await mkdir(dirname(to), { recursive: true });
			const copied = await copyFile(join(source, ...parts), to).then(
				() => true,
				() => false,
			);
			if (!copied) return false;
			// In seconds.
			const at = file.changedAt / 1000;
			await utimes(to, at, at);
			return true;
		},
		scan: scanFolder,
		remove: (view) => rm(view, { recursive: true, force: true }),
	};
}
