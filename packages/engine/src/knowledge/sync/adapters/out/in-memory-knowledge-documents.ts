import {
	DEFAULT_PAGE_READER,
	type PageReaderSetting,
	pageReaderSettingSchema,
} from "@nightshift/flows";
import { isKnowledgePath } from "../../../files";
import type { KnowledgeDocuments } from "../../application/ports";
import {
	entryOf,
	type KnowledgeDocument,
	type KnowledgeEntry,
} from "../../domain/entry";

/**
 * `KnowledgeDocuments` in memory: one map of values per project, as the
 * Yjs document holds them. A test lists a raw value (`listRaw`) as another
 * version would write it, and reads each change in order (`changes`).
 */
export function inMemoryKnowledgeDocuments() {
	const documents = new Map<
		string,
		{ files: Map<string, unknown>; settings: Map<string, unknown> }
	>();
	const updated = new Set<string>();
	const of = (projectId: string) => {
		const document = documents.get(projectId) ?? {
			files: new Map<string, unknown>(),
			settings: new Map<string, unknown>(),
		};
		documents.set(projectId, document);
		return document;
	};
	const change = (projectId: string, apply: () => void) => {
		apply();
		updated.add(projectId);
		twin.changes.push(projectId);
	};
	const twin = {
		/** Each change, by its project, in order. */
		changes: [] as string[],
		/** Puts a value in the document's files, as another version would. */
		listRaw(projectId: string, path: string, value: unknown) {
			change(projectId, () => of(projectId).files.set(path, value));
		},
		async open(projectId: string): Promise<KnowledgeDocument> {
			const { files, settings } = of(projectId);
			const meaningOn = () => settings.get("meaning") !== false;
			const learnsFromRunsOn = () => settings.get("learnFromRuns") !== false;
			const reader = (): PageReaderSetting => {
				const parsed = pageReaderSettingSchema.safeParse(
					settings.get("reader"),
				);
				return parsed.success ? parsed.data : DEFAULT_PAGE_READER;
			};
			return {
				name: `knowledge:${projectId}`,
				entries() {
					const entries = new Map<string, KnowledgeEntry>();
					for (const [path, value] of files) {
						if (!isKnowledgePath(path)) continue;
						const entry = entryOf(value);
						if (entry) entries.set(path, entry);
					}
					return entries;
				},
				isNew: () => !updated.has(projectId),
				async apply({ set = [], delete: removed = [] }) {
					if (removed.length === 0 && set.length === 0) return;
					change(projectId, () => {
						for (const path of removed) files.delete(path);
						for (const [path, entry] of set) files.set(path, entry);
					});
				},
				allHashes() {
					const hashes = new Set<string>();
					for (const value of files.values()) {
						const sha256 = (value as { sha256?: unknown } | null)?.sha256;
						if (typeof sha256 === "string") hashes.add(sha256);
					}
					return hashes;
				},
				meaningOn,
				async setMeaning(on) {
					if (meaningOn() === on) return;
					change(projectId, () =>
						on ? settings.delete("meaning") : settings.set("meaning", false),
					);
				},
				learnsFromRunsOn,
				async setLearnsFromRuns(on) {
					if (learnsFromRunsOn() === on) return;
					change(projectId, () =>
						on
							? settings.delete("learnFromRuns")
							: settings.set("learnFromRuns", false),
					);
				},
				reader,
				async setReader(setting) {
					const next = pageReaderSettingSchema.parse(setting);
					if (JSON.stringify(reader()) === JSON.stringify(next)) return;
					change(projectId, () =>
						next.kind === "nightshift"
							? settings.delete("reader")
							: settings.set("reader", next),
					);
				},
			};
		},
		async remove(projectId: string) {
			documents.delete(projectId);
			updated.delete(projectId);
		},
		async sizes() {
			return [...documents]
				.filter(([projectId]) => updated.has(projectId))
				.map(([projectId, { files }]) => ({
					projectId,
					bytes: JSON.stringify([...files]).length,
				}));
		},
	};
	return twin satisfies KnowledgeDocuments;
}

export type InMemoryKnowledgeDocuments = ReturnType<
	typeof inMemoryKnowledgeDocuments
>;
