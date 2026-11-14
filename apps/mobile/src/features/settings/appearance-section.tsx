import { NativePickerRow, NativeSection } from "@/shared/native-list";
import { APPEARANCES, useAppearance } from "@/shared/theme";

/** Dark, light, or as the phone is set. The choice stays on this phone. */
export function AppearanceSection() {
	const [appearance, setAppearance] = useAppearance();
	return (
		<NativeSection footer="System follows this phone.">
			<NativePickerRow
				title="Appearance"
				value={appearance}
				options={APPEARANCES}
				onChange={(next) => {
					const choice = APPEARANCES.find((option) => option.value === next);
					if (choice) setAppearance(choice.value);
				}}
			/>
		</NativeSection>
	);
}
