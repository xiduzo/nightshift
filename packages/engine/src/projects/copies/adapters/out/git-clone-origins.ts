import { type Git, systemGit } from "../../../../git";
import { normaliseRemote } from "../../../keep";
import type { CloneOrigins } from "../../application/ports";

/**
 * `CloneOrigins` over git on this computer. `wireCopies` builds it.
 */
export function gitCloneOrigins(git: Git = systemGit()): CloneOrigins {
	return {
		async match(path, remote) {
			const origin = await git.run(path, ["remote", "get-url", "origin"]);
			if (origin.exitCode !== 0) return false;
			const url = origin.stdout.trim();
			const found = normaliseRemote(url);
			if (found === remote) return true;
			if (found?.toLowerCase() !== remote.toLowerCase()) return false;
			const foundPath = found.slice(found.indexOf("/") + 1);
			const at = url.toLowerCase().lastIndexOf(foundPath.toLowerCase());
			if (at === -1) return false;
			const wanted = remote.slice(remote.indexOf("/") + 1);
			const fixed =
				url.slice(0, at) + wanted + url.slice(at + foundPath.length);
			const set = await git.run(path, ["remote", "set-url", "origin", fixed]);
			return set.exitCode === 0;
		},
	};
}
