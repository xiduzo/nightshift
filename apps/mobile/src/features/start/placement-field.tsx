import type { PlacementChoice } from "@nightshift/client";

import { RadioRows } from "./radio-rows";
import { placementHint } from "./start-words";

/**
 * Where the run goes: your Host, or a computer that is online, as radio
 * rows in one card. Offline ones show, but you cannot choose them.
 */
export function PlacementField({
	choices,
	value,
	onChange,
}: {
	choices: PlacementChoice[];
	value: string | null;
	onChange: (deviceId: string) => void;
}) {
	return (
		<RadioRows
			label="Where it runs"
			choices={choices.map((choice) => ({
				value: choice.deviceId,
				title: choice.name,
				caption: placementHint(choice),
				disabled: !choice.online,
			}))}
			value={value}
			onChange={onChange}
		/>
	);
}
