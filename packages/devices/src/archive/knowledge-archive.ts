import type { KnowledgeHost } from "@nightshift/engine";
import type { HostRelay } from "../contract";

/**
 * Knowledge content in the archive of the Host that keeps a Space (ADR 4),
 * as the engine's reconcile copies it there and fetches it: by hash, in
 * base64 over the Link (`archive.knowledgePut`, `archive.knowledgeGet`).
 * A Space this Replica keeps has no Host: its content stays here.
 *
 * `settled` waits until the Host has this Replica's copy of the knowledge
 * document and this Replica has the Host's: a step's changes reach the
 * Host before the step ends, and the next step on another Device reads
 * them. It waits a while at most, and not at all while the Host cannot be
 * reached.
 */
export function createKnowledgeArchive(deps: {
	relay: Pick<HostRelay, "knowledgePut" | "knowledge" | "inStep">;
	/** How long `settled` waits before a reconcile and after one. Default 3 s and 10 s. */
	waitMs?: { before: number; after: number };
	/** How often it looks again. Default 100 ms. */
	pollMs?: number;
}): KnowledgeHost {
	const { relay } = deps;
	const waitMs = deps.waitMs ?? { before: 3_000, after: 10_000 };
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
		async settled(spaceId, documentName, when) {
			const end = Date.now() + waitMs[when];
			while (Date.now() < end) {
				const inStep = await relay.inStep(spaceId, documentName);
				if (inStep !== false) return;
				await Bun.sleep(deps.pollMs ?? 100);
			}
		},
	};
}
