/**
 * The layout of a project's knowledge folder: the one module that names
 * what Night Shift keeps there, for the kits, the engine and the web app.
 * It imports nothing, so every layer can use it.
 *
 * These names are on the disk of every Device, in the Space's knowledge
 * document and in the shell of each kit a project copied. Renaming one
 * breaks what is already there. `layout.test.ts` pins them.
 *
 * "Night Shift's own" answers two questions, and the answers differ on
 * purpose. `learnings/accepted` is the one folder where they part: a source
 * must not overwrite what a person kept, and agents read it.
 *
 * | Folder               | A source fills it or a person removes it | A person or an agent reads it |
 * | -------------------- | ---------------------------------------- | ----------------------------- |
 * | `learnings/proposed` | no                                       | no                            |
 * | `learnings/accepted` | no                                       | yes                           |
 * | `evals`              | no                                       | no                            |
 * | any other            | yes                                      | yes                           |
 *
 * `isKnowledgeOwnFolder` answers the first question and
 * `isHiddenFromReaders` the second.
 */

const LEARNINGS_DIR = "learnings";
const EVALS_DIR = "evals";

/** The proposed learnings, which wait for a person. */
export const PROPOSED_LEARNINGS_DIR = `${LEARNINGS_DIR}/proposed`;
/** The learnings a person kept: agents read them. */
export const ACCEPTED_LEARNINGS_DIR = `${LEARNINGS_DIR}/accepted`;
/** The project's question set. */
export const QUESTION_SET_FILE = `${EVALS_DIR}/questions.json`;
/** The words people marked as not a topic on the Map. */
export const NOT_TOPICS_FILE = `${EVALS_DIR}/not-topics.json`;
/** The file Night Shift writes at the top of the folder. */
export const KNOWLEDGE_INDEX_FILE = "INDEX.md";
/** The search index, in the folder that holds the projects. Hidden, so no project id can name it. */
export const KNOWLEDGE_SEARCH_FILE = ".search.sqlite";
/** The state of the last reconcile, in the project's folder. Hidden: no walk lists it. */
export const KNOWLEDGE_RECONCILE_FILE = ".reconciled.json";
/**
 * What the sync kits name a file or folder while they write it, before a
 * rename makes it whole (`$dest.part`, `page.md.part`): never knowledge.
 */
export const KNOWLEDGE_STAGING_SUFFIX = ".part";

/** The folders no source fills: the kits' shell refuses them too. */
export const KNOWLEDGE_OWN_FOLDERS: readonly string[] = [
	LEARNINGS_DIR,
	EVALS_DIR,
];

/** That a folder is Night Shift's own, as the kits and the sources say it. */
export const KNOWLEDGE_OWN_FOLDERS_WORDS = `${KNOWLEDGE_OWN_FOLDERS.join(" and ")} are Night Shift's own.`;

/** Whether a path is this folder, or in it. */
function isAt(path: string, folder: string): boolean {
	return path === folder || path.startsWith(`${folder}/`);
}

/** Whether a source may not fill a folder, nor a person remove it: it is Night Shift's own, or in one. */
export function isKnowledgeOwnFolder(folder: string): boolean {
	return KNOWLEDGE_OWN_FOLDERS.some((own) => isAt(folder, own));
}

/** Whether a path is a proposed learning, or their folder. */
export function isProposedLearning(path: string): boolean {
	return isAt(path, PROPOSED_LEARNINGS_DIR);
}

/** Whether a path is in the folder of the question set and the words that are not topics, or is it. */
export function isQuestionSetPath(path: string): boolean {
	return isAt(path, EVALS_DIR);
}

/** Whether no person and no agent reads a path, though it syncs like the rest. */
export function isHiddenFromReaders(path: string): boolean {
	return isProposedLearning(path) || isQuestionSetPath(path);
}

/**
 * What the ids in a proposed learning's name start with. Spelled out, not a
 * range, because the kit's shell uses it too, and what a range holds there
 * depends on the locale.
 */
const ID_START =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Ids that become a part of a file name. */
const ID = new RegExp(`^[${ID_START}][${ID_START}_-]*$`);

/**
 * The name of a step's file in `learnings/proposed/`: `<runId>.<stepId>.md`,
 * or `<runId>.md` without a step. Refuses an id that could leave the folder.
 */
export function proposedLearningFileName(step: {
	runId: string;
	stepId?: string;
}): string {
	const { runId, stepId } = step;
	for (const id of [runId, ...(stepId === undefined ? [] : [stepId])]) {
		if (!ID.test(id)) throw new Error(`"${id}" is not an id.`);
	}
	return stepId === undefined ? `${runId}.md` : `${runId}.${stepId}.md`;
}

/**
 * One step's proposed learnings, by the name of its file in
 * `learnings/proposed/` (`<runId>.<stepId>.md`, or `<runId>.md` before steps
 * had files of their own): its run and step. Null for any other name.
 */
export function proposedLearningOf(
	name: string,
): { runId: string; stepId: string | null } | null {
	if (!name.endsWith(".md")) return null;
	const parts = name.slice(0, -3).split(".");
	const [runId, stepId, ...rest] = parts;
	if (runId === undefined || rest.length > 0 || !ID.test(runId)) return null;
	if (stepId === undefined) return { runId, stepId: null };
	return ID.test(stepId) ? { runId, stepId } : null;
}

/**
 * `proposedLearningOf` in the shell of the review kit: `is_proposed_learning
 * "$name"` says whether a name is one. The kit's Keep and Delete run where no
 * TypeScript does, so the rule has this second form, next to the first.
 * `learnings-kit.test.ts` of the engine and `layout.test.ts` run both.
 */
export const IS_PROPOSED_LEARNING_SHELL = `is_proposed_learning() {
	case "$1" in
		*[!${ID_START}_.-]*|[!${ID_START}]*|*.[!${ID_START}]*|*.*.*.md) return 1 ;;
		*.md) return 0 ;;
	esac
	return 1
}`;

/**
 * The proposed learning at a path of the folder: the name of its file, which
 * keeps or deletes it, and its run and step. Null for any other path, also
 * for a file in that folder with another name.
 */
export function proposedLearningAt(
	path: string,
): { id: string; runId: string; stepId: string | null } | null {
	const start = `${PROPOSED_LEARNINGS_DIR}/`;
	if (!path.startsWith(start)) return null;
	const id = path.slice(start.length);
	const step = proposedLearningOf(id);
	return step && { id, ...step };
}

/**
 * The folders of the knowledge an Agent node may pick, from the paths the
 * Knowledge page lists: every folder that holds a file, at any depth,
 * sorted. The listing already leaves out what is hidden from readers, so
 * this filters nothing.
 */
export function knowledgeFoldersOf(paths: readonly string[]): string[] {
	const folders = new Set<string>();
	for (const path of paths) {
		const parts = path.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) {
			folders.add(parts.slice(0, i).join("/"));
		}
	}
	return [...folders].sort();
}
