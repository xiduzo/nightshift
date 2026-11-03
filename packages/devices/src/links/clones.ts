import type { PeerProjects } from "@nightshift/engine";
import { ORPCError } from "@orpc/client";
import type { HostClient } from "../contract";
import { isOlderHost } from "./from-host";

/**
 * What a Device tells a Host of its Clones each time its link comes
 * online: for every Space the Host keeps, the Projects this computer has
 * a folder of (`sync.setClones`). A Clone the Host missed (a lost
 * `addClone`) heals, and one this computer no longer has goes. The Host
 * changes nothing when it is in step, so saying it again is safe.
 *
 * Run it as a stream of the link (`Link.stream`): it says it once, then
 * waits until the link drops. A failure throws, and the link tries again
 * after its backoff. An older Host, which has no `setClones`, and a Space
 * where the person may not add projects are left alone.
 */
export function tellClones(deps: {
	/** The Spaces this Host keeps for this computer (`HostSpaces.ofHost`). */
	spaces(): Promise<string[]>;
	projects: Pick<PeerProjects, "clonedHere">;
	/** This computer's Device name, as the Host shows it. */
	deviceName(): Promise<string>;
}): (client: HostClient, signal: AbortSignal) => Promise<void> {
	return async (client, signal) => {
		const deviceName = await deps.deviceName();
		for (const spaceId of await deps.spaces()) {
			if (signal.aborted) return;
			const projectIds = await deps.projects.clonedHere(spaceId);
			try {
				await client.sync.setClones(
					{ spaceId, projectIds, deviceName },
					{ signal },
				);
			} catch (error) {
				if (isOlderHost(error)) break;
				if (error instanceof ORPCError && error.code === "FORBIDDEN") continue;
				throw error;
			}
		}
		await new Promise<void>((resolve) => {
			if (signal.aborted) resolve();
			else signal.addEventListener("abort", () => resolve(), { once: true });
		});
	};
}
