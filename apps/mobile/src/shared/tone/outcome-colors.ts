import type { OutcomeColor } from "@nightshift/flows";

/**
 * The classes of one flow color (`--color-outcome-<color>`): its text, the
 * stripe of a card, the border and soft fill of a chosen card, and a
 * filled button. The button's text is `text-primary-foreground`: light on
 * the 600 shades of the light theme, dark on the 400 shades of the dark
 * theme, so it stays readable in both.
 */
export type OutcomeClass = {
	text: string;
	stripe: string;
	chosen: string;
	button: string;
};

/** Each class in full, so Tailwind finds it. */
export const OUTCOME_CLASS: Record<OutcomeColor, OutcomeClass> = {
	red: {
		text: "text-outcome-red",
		stripe: "bg-outcome-red",
		chosen: "border-outcome-red bg-outcome-red/10",
		button: "bg-outcome-red active:bg-outcome-red/90",
	},
	orange: {
		text: "text-outcome-orange",
		stripe: "bg-outcome-orange",
		chosen: "border-outcome-orange bg-outcome-orange/10",
		button: "bg-outcome-orange active:bg-outcome-orange/90",
	},
	amber: {
		text: "text-outcome-amber",
		stripe: "bg-outcome-amber",
		chosen: "border-outcome-amber bg-outcome-amber/10",
		button: "bg-outcome-amber active:bg-outcome-amber/90",
	},
	yellow: {
		text: "text-outcome-yellow",
		stripe: "bg-outcome-yellow",
		chosen: "border-outcome-yellow bg-outcome-yellow/10",
		button: "bg-outcome-yellow active:bg-outcome-yellow/90",
	},
	lime: {
		text: "text-outcome-lime",
		stripe: "bg-outcome-lime",
		chosen: "border-outcome-lime bg-outcome-lime/10",
		button: "bg-outcome-lime active:bg-outcome-lime/90",
	},
	green: {
		text: "text-outcome-green",
		stripe: "bg-outcome-green",
		chosen: "border-outcome-green bg-outcome-green/10",
		button: "bg-outcome-green active:bg-outcome-green/90",
	},
	teal: {
		text: "text-outcome-teal",
		stripe: "bg-outcome-teal",
		chosen: "border-outcome-teal bg-outcome-teal/10",
		button: "bg-outcome-teal active:bg-outcome-teal/90",
	},
	cyan: {
		text: "text-outcome-cyan",
		stripe: "bg-outcome-cyan",
		chosen: "border-outcome-cyan bg-outcome-cyan/10",
		button: "bg-outcome-cyan active:bg-outcome-cyan/90",
	},
	sky: {
		text: "text-outcome-sky",
		stripe: "bg-outcome-sky",
		chosen: "border-outcome-sky bg-outcome-sky/10",
		button: "bg-outcome-sky active:bg-outcome-sky/90",
	},
	blue: {
		text: "text-outcome-blue",
		stripe: "bg-outcome-blue",
		chosen: "border-outcome-blue bg-outcome-blue/10",
		button: "bg-outcome-blue active:bg-outcome-blue/90",
	},
	indigo: {
		text: "text-outcome-indigo",
		stripe: "bg-outcome-indigo",
		chosen: "border-outcome-indigo bg-outcome-indigo/10",
		button: "bg-outcome-indigo active:bg-outcome-indigo/90",
	},
	violet: {
		text: "text-outcome-violet",
		stripe: "bg-outcome-violet",
		chosen: "border-outcome-violet bg-outcome-violet/10",
		button: "bg-outcome-violet active:bg-outcome-violet/90",
	},
	pink: {
		text: "text-outcome-pink",
		stripe: "bg-outcome-pink",
		chosen: "border-outcome-pink bg-outcome-pink/10",
		button: "bg-outcome-pink active:bg-outcome-pink/90",
	},
	gray: {
		text: "text-outcome-gray",
		stripe: "bg-outcome-gray",
		chosen: "border-outcome-gray bg-outcome-gray/10",
		button: "bg-outcome-gray active:bg-outcome-gray/90",
	},
};
