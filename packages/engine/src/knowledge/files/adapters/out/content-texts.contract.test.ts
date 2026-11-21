import { contentTextsContract } from "./content-texts.contract";
import { fileLoadersContentTexts } from "./file-loaders-content-texts";
import { inMemoryContentTexts } from "./in-memory-content-texts";

/** The contract of `ContentTexts`, on both adapters. */

contentTextsContract("in memory", async () => ({
	contentTexts: inMemoryContentTexts(),
	close: async () => {},
}));

contentTextsContract("over file-loaders", async () => ({
	contentTexts: fileLoadersContentTexts(),
	close: async () => {},
}));
