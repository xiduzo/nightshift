/**
 * The loaders of PDF and Word files: their text as LangChain `Document`s.
 * The knowledge reads them for its index, its search and its page readers.
 */
export {
	type DocumentMetadata,
	isDocument,
	LOCAL_ONLY_BYTES,
	loadDocument,
	loadDocumentContent,
	textOf,
} from "./file-loaders";
