/**
 * The form of an inspector: a labelled field, a note, a section that folds,
 * and the tabs.
 */

export { type Choice, ChoiceField, ChoiceToggle } from "./choice";
export {
	Field,
	InspectorSection,
	Note,
	Optional,
} from "./fields";
export { type InspectorTab, InspectorTabs } from "./inspector-tabs";
export { NumberField } from "./number-field";
export { withOptional } from "./optional";
export { SwitchField } from "./switch-field";
