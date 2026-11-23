import type { SavedValues } from "../domain/setting-fields";
import type { SettingsWrite } from "../domain/settings-patch";

/**
 * The saved values of this computer's settings (its Device document). A
 * read is synchronous: the readers of the settings read them often.
 */
export type SavedSettings = {
	/** The saved values that parse. An unknown key or an old value is left out. */
	read(): SavedValues;
	/** Saves and forgets in one change of the document. */
	write(plan: SettingsWrite): Promise<void>;
	/** Calls `listener` after each change of the saved values, here or synced. Returns the unsubscribe. */
	onChange(listener: () => void): () => void;
};
