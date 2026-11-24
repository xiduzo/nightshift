import { holdFolder } from "../../application/hold-folder";
import { reconcileFolder } from "../../application/reconcile-folder";
import { reconcileUnlessHeld } from "../../application/reconcile-unless-held";
import { removeSourceFolder } from "../../application/remove-source-folder";
import { contentHash } from "../../domain/entry";
import { inMemorySyncPorts } from "./in-memory-neighbours";

/**
 * The sync over in-memory adapters: the real use cases, with the documents,
 * the Spaces and the content a test puts in. The use-case test of every
 * slice that reads the documents or holds a folder takes this one. Test
 * code: production code never imports this file.
 */
export function inMemorySync() {
	const ports = inMemorySyncPorts();
	const reconcileOne = reconcileFolder(ports);
	const bound = {
		...ports,
		reconcile: (projectId: string) => reconcileOne({ projectId }),
	};
	const hold = holdFolder(bound);
	const unlessHeld = reconcileUnlessHeld(bound);
	const removeFolder = removeSourceFolder(bound);
	const { spaces } = ports;
	/** Each hold of a folder, its start and its end, in order. */
	const holds: string[] = [];
	return {
		...ports,
		holds,
		/**
		 * Lists a file in the project's document, as another Device published
		 * it. Its content is on this computer, at the Host, or nowhere.
		 */
		async publish(
			projectId: string,
			path: string,
			text: string,
			changedAt = 1,
			at: "here" | "host" | "nowhere" = "here",
		) {
			const content = new TextEncoder().encode(text);
			const sha256 = contentHash(content);
			const entry = {
				sha256,
				size: content.length,
				changedAt,
				deviceId: "desktop",
			};
			const document = await ports.documents.open(projectId);
			await document.apply({ set: [[path, entry]] });
			const spaceId = (await spaces.spaceOf(projectId)) ?? "";
			const ref = { kind: "content", spaceId, sha256 } as const;
			if (at === "here") ports.archive.keepHere(ref, content);
			if (at === "host")
				ports.archive.host.set(`${spaceId}/${sha256}`, content);
		},
		status: {
			spaceOf: spaces.spaceOf,
			isShared: spaces.isShared,
		},
		reconciler: {
			reconcileUnlessHeld: (projectId: string) => unlessHeld({ projectId }),
			removeFolder: (projectId: string, folder: string) =>
				removeFolder({ projectId, folder }),
			async startStep(projectId: string) {
				holds.push(`hold ${projectId}`);
				const started = await hold({ projectId });
				return {
					done: async () => {
						await started.done();
						holds.push(`done ${projectId}`);
					},
				};
			},
		},
	};
}
