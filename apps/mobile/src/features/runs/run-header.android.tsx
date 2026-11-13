import {
	DropdownMenu,
	DropdownMenuItem,
	HorizontalDivider,
	Host,
	IconButton,
	RNHostView,
	Row,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Stack } from "expo-router";
import { EllipsisVertical, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { useThemeColors } from "@/shared/theme";
import type { HeaderAction, RunHeaderProps } from "./run-header-types";

/**
 * Android: the run's main action is a text button in the top app bar
 * (Stop in the destructive color), then the overflow menu. Android has no
 * bottom toolbar here: the run's other views (Transcript, Changed files,
 * Share) open from the overflow menu, under its actions, and from their
 * rows in the page. The native toolbar items of Android need drawables
 * for their icons, which this app does not ship: Compose draws these
 * itself. iOS has the default file (`run-header.tsx`).
 */
export function RunHeader({ primary, menu, views }: RunHeaderProps) {
	const { scheme, colors } = useThemeColors();
	const [open, setOpen] = useState(false);
	const pick = (item: HeaderAction) => {
		setOpen(false);
		item.onPress();
	};
	const item = (entry: HeaderAction) => (
		<DropdownMenuItem
			key={entry.key}
			enabled={!entry.disabled}
			onClick={() => pick(entry)}
			elementColors={
				entry.destructive ? { textColor: colors.destructive } : undefined
			}
		>
			<DropdownMenuItem.LeadingIcon>
				<MenuIcon
					icon={entry.icon.lucide}
					color={entry.destructive ? colors.destructive : undefined}
				/>
			</DropdownMenuItem.LeadingIcon>
			<DropdownMenuItem.Text>
				<Text>{entry.label}</Text>
			</DropdownMenuItem.Text>
		</DropdownMenuItem>
	);
	return (
		<Stack.Toolbar placement="right" asChild>
			<Host matchContents colorScheme={scheme}>
				<Row verticalAlignment="center">
					{primary ? (
						<TextButton
							onClick={primary.onPress}
							enabled={!primary.disabled}
							colors={
								primary.destructive
									? { contentColor: colors.destructive }
									: undefined
							}
						>
							<Text>{primary.label}</Text>
						</TextButton>
					) : null}
					{menu.length + views.length > 0 ? (
						<DropdownMenu
							expanded={open}
							onDismissRequest={() => setOpen(false)}
						>
							<DropdownMenu.Trigger>
								<IconButton
									onClick={() => setOpen(true)}
									modifiers={[
										semantics({ contentDescription: "More actions" }),
									]}
								>
									<MenuIcon icon={EllipsisVertical} />
								</IconButton>
							</DropdownMenu.Trigger>
							<DropdownMenu.Items>
								{menu.map(item)}
								{menu.length > 0 && views.length > 0 ? (
									<HorizontalDivider />
								) : null}
								{views.map(item)}
							</DropdownMenu.Items>
						</DropdownMenu>
					) : null}
				</Row>
			</Host>
		</Stack.Toolbar>
	);
}

/** A lucide icon in a Compose slot. */
function MenuIcon({ icon, color }: { icon: LucideIcon; color?: string }) {
	return (
		<RNHostView matchContents>
			<View>
				<Icon as={icon} size={22} color={color} className="text-foreground" />
			</View>
		</RNHostView>
	);
}
