import {
	NativeSelectOptGroup,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useProjectFolder } from "../project-folder-context";
import { kitChoices } from "./kit-choices";

/**
 * The "Kits" group of a select of flows to run (`kitChoices`). In a
 * project without a folder, the kits that need one cannot be picked.
 */
export function KitOptions({ current }: { current: string }) {
	const folder = useProjectFolder();
	return (
		<NativeSelectOptGroup label="Kits">
			{kitChoices(folder, current).map(({ name, label, disabled }) => (
				<NativeSelectOption key={name} value={name} disabled={disabled}>
					{label}
				</NativeSelectOption>
			))}
		</NativeSelectOptGroup>
	);
}
