import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { SETTING_KEYS, type SettingsPatch } from "../../domain/setting-defs";
import { planSettingsSave } from "../../domain/settings-patch";
import { yjsSavedSettings } from "./yjs-saved-settings";

/**
 * A save is one change of the document: what to forget, then what to
 * save. Before, one loop saved and forgot in the order of the settings.
 * A forget writes no item, so both give the same bytes: a Device of
 * either version reads the same document.
 */

const CLIENT = 7;

/** A document with some saved values, as the same client wrote them. */
function documentWithValues(): Y.Doc {
	const doc = new Y.Doc();
	doc.clientID = CLIENT;
	doc.transact(() => {
		const settings = doc.getMap("settings");
		settings.set("maxTurns", 40);
		settings.set("budgetUsd", 3);
		settings.set("scheduler", false);
	});
	return doc;
}

/** The save of the version before: one loop over the settings, in their order. */
function interleavedSave(doc: Y.Doc, patch: Record<string, unknown>) {
	doc.transact(() => {
		const settings = doc.getMap("settings");
		for (const key of SETTING_KEYS) {
			const value = patch[key];
			if (value === null) settings.delete(key);
			else if (value !== undefined) settings.set(key, value);
		}
		if (typeof patch.usage === "boolean") settings.set("usageSeen", true);
	});
}

describe("yjsSavedSettings", () => {
	test("a save that forgets and sets gives the bytes of the save before it", async () => {
		const patch = {
			budgetUsd: null,
			maxTurns: 60,
			scheduler: null,
			usage: true,
			maxConcurrentRuns: 2,
		} as SettingsPatch;

		const before = documentWithValues();
		interleavedSave(before, patch);

		const doc = documentWithValues();
		const settings = doc.getMap("settings");
		let revision = 0;
		settings.observe(() => {
			revision += 1;
		});
		const saved = yjsSavedSettings({
			settings,
			revision: () => revision,
			change: async (fn) => {
				doc.transact(fn);
			},
		} as Parameters<typeof yjsSavedSettings>[0]);
		const ground = { env: {}, embeddingModel: "embed:1" };
		await saved.write(planSettingsSave(patch, saved.read(), ground));

		expect(Y.encodeStateAsUpdate(doc)).toEqual(Y.encodeStateAsUpdate(before));
		expect(settings.toJSON()).toEqual(before.getMap("settings").toJSON());
	});
});
