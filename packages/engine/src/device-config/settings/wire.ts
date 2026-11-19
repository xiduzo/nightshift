import { NIGHT_SHIFT } from "../../contract";
import type { DeviceDocument } from "../../documents";
import { DEFAULT_EMBEDDING_MODEL } from "../../knowledge";
import { yjsSavedSettings } from "./adapters/out/yjs-saved-settings";
import { saveSettings } from "./application/save-settings";
import { viewSettings } from "./application/view-settings";
import { type RunSettings, runSettingsOf } from "./domain/run-settings";
import type { Settings, SettingsPatch } from "./domain/setting-defs";
import {
	currentSettings,
	type SettingsGround,
	type SettingsView,
} from "./domain/setting-fields";

/** This computer's settings, as their readers and the doors use them. */
export type SettingsStore = {
	/** Reads the saved values. Call once before `current`. */
	load(): Promise<void>;
	current(): Settings;
	view(): SettingsView;
	save(patch: SettingsPatch): Promise<SettingsView>;
	/** The engine's part of the settings. */
	run(): RunSettings;
	/** Calls `listener` after each change of the saved values, here or synced. Returns the unsubscribe. */
	onChange(listener: () => void): () => void;
};

/**
 * The settings of this computer over its Device document. Each one is
 * saved there, else read from the environment (`env`), else its default.
 * It binds the use cases `viewSettings` and `saveSettings` behind the
 * store that the readers and the doors use today. The doors check the
 * owner of this computer first, so the store acts as Night Shift.
 */
export function wireSettings(deps: {
	document: DeviceDocument;
	env: Readonly<Record<string, string | undefined>>;
}): SettingsStore {
	const saved = yjsSavedSettings(deps.document);
	const ground: SettingsGround = {
		env: deps.env,
		embeddingModel: DEFAULT_EMBEDDING_MODEL,
	};
	const view = viewSettings({ saved, ground });
	const save = saveSettings({ saved, ground });
	const current = () => currentSettings(saved.read(), ground);
	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		current,
		view: () => view(NIGHT_SHIFT),
		save: (patch) => save(NIGHT_SHIFT, patch),
		onChange: (listener) => saved.onChange(listener),
		run: () => runSettingsOf(current()),
	};
}
