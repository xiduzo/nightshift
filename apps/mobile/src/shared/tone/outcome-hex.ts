import type { OutcomeColor } from "@nightshift/flows";

/**
 * The flow colors as values, for native views that take a color, not a
 * class (the SwiftUI and Compose rows). The same tokens as
 * `--color-outcome-<color>` in `packages/ui-native/src/styles/global.css`:
 * a 700 or 800 shade on light, a 300 or 400 shade on dark.
 * `contrast.test.ts` checks that they match the CSS.
 */
export const OUTCOME_HEX: Record<
	"light" | "dark",
	Record<OutcomeColor, string>
> = {
	light: {
		red: "#c10007",
		orange: "#ca3500",
		amber: "#973c00",
		yellow: "#894b00",
		lime: "#3c6300",
		green: "#016630",
		teal: "#00786f",
		cyan: "#007595",
		sky: "#0069a8",
		blue: "#1447e6",
		indigo: "#432dd7",
		violet: "#7008e7",
		pink: "#c6005c",
		gray: "#364153",
	},
	dark: {
		red: "#ffa2a2",
		orange: "#ff8904",
		amber: "#ffb900",
		yellow: "#fdc700",
		lime: "#9ae600",
		green: "#05df72",
		teal: "#00d5be",
		cyan: "#00d3f2",
		sky: "#00bcff",
		blue: "#8ec5ff",
		indigo: "#a3b3ff",
		violet: "#c4b4ff",
		pink: "#fda5d5",
		gray: "#d1d5dc",
	},
};
