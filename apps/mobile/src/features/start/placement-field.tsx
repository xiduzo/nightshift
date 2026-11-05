import type { PlacementChoice } from "@nightshift/client";

import { RadioRows } from "./radio-rows";
import { placementHint } from "./start-words";

/** The choice for no device: the flow says where the run goes. */
const AUTOMATIC = "__automatic__";

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
	onChange: (deviceId: string | null) => void;
}) {
	return (
		<RadioRows
			label="Where it runs"
			choices={[
				{
					value: AUTOMATIC,
					title: "Automatic",
					caption: "Each step runs where the flow says, else on your Host",
					disabled: false,
				},
				...choices.map((choice) => ({
					value: choice.deviceId,
					title: choice.name,
					caption: placementHint(choice),
					disabled: !choice.online,
				})),
			]}
			value={value ?? AUTOMATIC}
			onChange={(next) => onChange(next === AUTOMATIC ? null : next)}
		/>
	);
}
