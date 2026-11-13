/**
 * A page as a native grouped list: SwiftUI on iOS (the Settings look,
 * swipe actions), Jetpack Compose Material 3 on Android (grouped cards,
 * long-press menus). One API, two drawings.
 */

// NativeOptionRow, NativePickerRow, NativeToggleRow and RowAction go back
// on the barrel with the first screen that imports them (STRUCTURE.md 4).
export {
	NativeButtonRow,
	NativeList,
	NativeLoadingRow,
	NativePickerRow,
	NativeRow,
	NativeSection,
	NativeTextRow,
	NativeTitleRow,
	NativeToggleRow,
export type { NativeIcon } from "./types";
} from "./native-list";
