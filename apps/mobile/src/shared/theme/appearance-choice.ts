/** How the app looks: always dark, always light, or as the phone is set. */
export type Appearance = "dark" | "light" | "system";

/** The choices in the order Settings shows them. */
export const APPEARANCES: readonly { value: Appearance; label: string }[] = [
	{ value: "dark", label: "Dark" },
	{ value: "light", label: "Light" },
	{ value: "system", label: "System" },
];

/** A kept text as an Appearance. Anything else follows the phone. */
export function appearanceOf(kept: string | null | undefined): Appearance {
	return kept === "dark" || kept === "light" ? kept : "system";
}
