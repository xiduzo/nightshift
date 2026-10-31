import type { KnowledgeHost } from "@nightshift/engine";
import type { HostRelay } from "../contract";

/**
 * Knowledge content in the archive of the Host that keeps a Space (ADR 4),
 * as the engine's reconcile copies it there and fetches it: by hash, in
 * base64 over the Link (`archive.knowledgePut`, `archive.knowledgeGet`).
 * A Space this Replica keeps has no Host: its content stays here.
 */
export function createKnowledgeArchive(deps: {
	relay: Pick<HostRelay, "knowledgePut" | "knowledge">;
}): KnowledgeHost {
	const { relay } = deps;
	return {
		async put(spaceId, sha256, content) {
			await relay.knowledgePut(
				{ spaceId, sha256 },
				Buffer.from(content).toString("base64"),
			);
		},
		async get(spaceId, sha256) {
			const content = await relay.knowledge({ spaceId, sha256 });
			return content === null
				? null
				: new Uint8Array(Buffer.from(content, "base64"));
		},
	};
}
