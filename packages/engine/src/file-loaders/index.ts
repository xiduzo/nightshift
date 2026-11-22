/**
 * The loaders of the knowledge's files: the start of a text file, and the
 * text of PDF and Word files as LangChain `Document`s. The knowledge reads
 * them for its index, its search and its page readers.
 */
export {
	isDocument,
	LOCAL_ONLY_BYTES,
	loadDocument,
	loadDocumentContent,
	textOf,
} from "./file-loaders";
export { readStart } from "./read-start";
