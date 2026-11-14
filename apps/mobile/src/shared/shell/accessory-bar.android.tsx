import {
	Button,
	Column,
	HorizontalFloatingToolbar,
	Host,
	Text,
} from "@expo/ui/jetpack-compose";
import { clickable, padding, width } from "@expo/ui/jetpack-compose/modifiers";
import { router } from "expo-router";

import { useThemeColors } from "@/shared/theme";
import type { AccessoryBarProps } from "./tabs";

/** The toolbar's height, in dp. */
const BAR_HEIGHT = 64;

/** A tap on what waits opens Needs you. */
function openNeeds() {
	router.navigate("/");
}

/**
 * The bar above the tabs on Android: a Material 3 floating toolbar,
 * 12 dp above the tab bar (`TabBar` places it). What waits, the option
 * you chose in its flow color, and Send in that color. iOS has the
 * default file (`accessory-bar.tsx`).
 */
export function AccessoryBar({
	caption,
	label,
	color,
	short,
	action,
}: AccessoryBarProps) {
	const { scheme, colors } = useThemeColors();
	return (
		// A fixed height: measured from its content, the toolbar grows
		// into a tall oval.
		<Host
			matchContents={{ horizontal: true }}
			style={{ height: BAR_HEIGHT }}
			colorScheme={scheme}
		>
			<HorizontalFloatingToolbar>
				<Column
					verticalArrangement={{ spacedBy: 2 }}
					modifiers={[width(208), padding(12, 6, 8, 6), clickable(openNeeds)]}
				>
					{caption ? (
						<Text style={{ typography: "labelSmall" }} maxLines={1}>
							{caption}
						</Text>
					) : null}
					<Text
						style={{ typography: "titleSmall" }}
						color={caption ? color : undefined}
						maxLines={1}
					>
						{caption ? label : short}
					</Text>
				</Column>
				{action ? (
					<Button
						onClick={action.onPress}
						enabled={!action.disabled}
						colors={
							color
								? {
										containerColor: color,
										contentColor: colors.primaryForeground,
									}
								: undefined
						}
					>
						<Text>{action.label}</Text>
					</Button>
				) : null}
			</HorizontalFloatingToolbar>
		</Host>
	);
}
