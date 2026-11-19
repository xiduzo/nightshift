// Which revision the editor shows, and the revision link that opens the sheet.

import { useEffect, useState } from "react";
import type { RevisionOnCanvas } from "./revisions-sheet";

/**
 * Which revision shows: whether the sheet of revisions is open, the
 * revision open in it, and the revision the canvas shows instead of the
 * draft. A revision link opens the sheet on that revision, once.
 */
export function useRevisionView({
	revisionLink,
	onRevisionLinkUsed,
}: {
	revisionLink: string | undefined;
	onRevisionLinkUsed: (() => void) | undefined;
}) {
	const [revisionsOpen, setRevisionsOpen] = useState(
		revisionLink !== undefined,
	);
	const [openRevision, setOpenRevision] = useState<string | null>(
		revisionLink ?? null,
	);
	// The revision the canvas shows instead of the draft.
	const [shownRevision, setShownRevision] = useState<RevisionOnCanvas | null>(
		null,
	);
	// The sheet opened with the revision link: drop it from the address.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once, at the start.
	useEffect(() => {
		if (revisionLink !== undefined) onRevisionLinkUsed?.();
	}, []);
	return {
		revisionsOpen,
		setRevisionsOpen,
		openRevision,
		setOpenRevision,
		shownRevision,
		setShownRevision,
	};
}
