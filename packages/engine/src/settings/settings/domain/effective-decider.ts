import type { DeciderName } from "@nightshift/flows";
import type { SettingsView } from "./setting-fields";

/**
 * The decider a new Decision node starts on (Q22): the one the person
 * saved, else TypeSafe Jev when its key is set, else Ollama on this
 * computer, which needs no account. Only new nodes follow it: a node that
 * names no decider still runs on TypeSafe (`decisionDecider` of
 * `@nightshift/flows`), so no flow file changes.
 */
export function effectiveDecider(
	view: Pick<SettingsView, "values" | "fields">,
	typesafeKey: boolean,
): DeciderName {
	if (view.fields.decisionDecider.source !== "default") {
		return view.values.decisionDecider;
	}
	return typesafeKey ? "typesafe" : "ollama";
}

/**
 * The settings as the screens read them: an unsaved decider is the
 * effective default (`effectiveDecider`), as its value and as its default.
 * The editor gives new nodes `values.decisionDecider`.
 */
export function withEffectiveDecider(
	view: SettingsView,
	typesafeKey: boolean,
): SettingsView {
	const decider = effectiveDecider(view, typesafeKey);
	if (view.fields.decisionDecider.source !== "default") return view;
	return {
		values: { ...view.values, decisionDecider: decider },
		fields: {
			...view.fields,
			decisionDecider: { ...view.fields.decisionDecider, default: decider },
		},
	};
}
