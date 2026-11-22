/**
 * The search index of the projects' knowledge on this computer: an SQLite
 * file of its own, a rebuildable cache. It keeps the files, their sections,
 * their words and their vectors. The knowledge search decides what goes in
 * and how a search ranks.
 */

export {
	createSearchStore,
	type IndexedFile,
	type IndexedFileWrite,
	type SearchStore,
	type SectionToEmbed,
	type WordSection,
} from "./search-index";
