/** What a write changes, and which reads that makes stale: the one table of both apps. */

export {
	type Change,
	type DocumentKind,
	documentOf,
	heldByDocuments,
	staleAfter,
} from "./changes";
