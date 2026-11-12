/** What a write changes, and which reads that makes stale: the one table of both apps. */

export {
	type Change,
	documentOf,
	heldByDocuments,
	savedBy,
	staleAfter,
} from "./changes";
