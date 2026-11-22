import type { PageReaderSetting } from "@nightshift/flows";
import type { AddressRules } from "../../web-access";
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
		dataDir: deps.dataDir,
		settings: {
			setting: deps.setting,
			choose: () => {
				throw new Error("No test chooses a reader here.");
			},
		},
		rules: deps.rules,
		...(deps.secret ? { secret: deps.secret } : {}),
	});
}
