/**
 * Value presets: Filter, Pick fields, Sort, Limit and Remove duplicates.
 * Each gives a Value by rule its expression and output schema, from a list
 * and the shape of its items.
 */

export {
	FILTER_COMPARES,
	type FilterCompare,
	itemFields,
	jsonataPath,
	type PresetSource,
	presetSources,
	VALUE_PRESETS,
	type ValuePresetInput,
	type ValuePresetName,
	type ValuePresetResult,
	valuePreset,
} from "./value-presets";
