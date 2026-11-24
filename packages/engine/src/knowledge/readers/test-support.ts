import type { PageReaderSetting } from "@nightshift/flows";
import type { AddressRules } from "../../web-access";
import { inMemoryKnowledgeDocuments } from "../sync/adapters/out/in-memory-knowledge-documents";
import type { ReaderSecret } from "./domain/reader-choice";
import { type PageReaders, wireReaders } from "./wire";

/**
 * The page readers as the tests of a whole module build them: a setting per
 * project, and no person who chooses one. Bound as `wireReaders` binds them.
 * Test code.
 */
export function createPageReaders(deps: {
	dataDir: string;
	setting(projectId: string): Promise<PageReaderSetting>;
	rules: () => AddressRules;
	secret?: ReaderSecret;
}): PageReaders {
	return wireReaders({
		access: { openSpace: async () => {} },
		dataDir: deps.dataDir,
		documents: {
			async open(projectId) {
				const documents = inMemoryKnowledgeDocuments();
				const document = await documents.open(projectId);
				await document.setReader(await deps.setting(projectId));
				return document;
			},
		},
		rules: deps.rules,
		...(deps.secret ? { secret: deps.secret } : {}),
	});
}
