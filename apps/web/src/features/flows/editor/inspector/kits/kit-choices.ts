import { kitList } from "@nightshift/flows";

/** The kits Night Shift ships, the same in every project. */
const KITS = kitList();

/** One kit as an option of a select of flows to run. */
export type KitChoice = { name: string; label: string; disabled: boolean };

/**
 * The kits a Subflow or a cascade tier can run, as options. In a project
 * without a folder (`folder` false), a kit that works in the project's
 * folder says so and cannot be picked. The kit picked now (`current`)
 * stays as it is: the node's warning says why it fails.
 */
export function kitChoices(folder: boolean, current: string): KitChoice[] {
	return KITS.map(({ name, needsFolder }) => {
		const off = !folder && needsFolder;
		return {
			name,
			label: off ? `${name} (needs a folder)` : name,
			disabled: off && name !== current,
		};
	});
}
