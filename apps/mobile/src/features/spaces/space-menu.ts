import type { HeaderItem } from "@/shared/header";

/** The Spaces of the person, and the one this phone works in. */
type SpaceList = {
	active: string | null;
	spaces: readonly { id: string; name: string }[];
};

/**
 * The Space menu of a header: a check on the Space this phone works in,
 * or on the one it switches to while the switch is on its way. Picking
 * the Space it works in already does nothing.
 */
export function spaceMenu(
	list: SpaceList,
	switching: string | null,
	switchTo: (spaceId: string) => void,
): Extract<HeaderItem, { kind: "menu" }> {
	const chosen = switching ?? list.active;
	const active = list.spaces.find((space) => space.id === chosen);
	return {
		kind: "menu",
		key: "space",
		label: active ? `Space, ${active.name}` : "Choose a Space",
		hint: "Chooses the Space this phone works in",
		sf: "square.stack.3d.up",
		title: active?.name ?? "Space",
		options: list.spaces.map((space) => ({
			value: space.id,
			label: space.name,
		})),
		value: active?.id ?? null,
		onChange: (spaceId) => {
			if (spaceId !== list.active) switchTo(spaceId);
		},
		disabled: switching !== null,
	};
}
