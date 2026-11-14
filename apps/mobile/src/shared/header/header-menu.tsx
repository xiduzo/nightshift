import {
	DropdownMenu,
	DropdownMenuItem,
	Host,
	RNHostView,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Check, ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { useThemeColors } from "@/shared/theme";
import type { HeaderItem } from "./header-items";

/**
 * A menu item of the header on Android: a Material text button with the
 * chosen option, and a Material dropdown menu with a check on it. Only
 * `header-toolbar.android.tsx` draws it: iOS uses `Stack.Toolbar.Menu`.
 */
export function HeaderMenu({
	item,
}: {
	item: Extract<HeaderItem, { kind: "menu" }>;
}) {
	const { scheme, colors } = useThemeColors();
	const [open, setOpen] = useState(false);
	return (
		<Host matchContents colorScheme={scheme}>
			<DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
				<DropdownMenu.Trigger>
					<TextButton
						onClick={() => setOpen(true)}
						enabled={!item.disabled}
						colors={{ contentColor: colors.foreground }}
					>
						<Text maxLines={1}>{item.title}</Text>
						<RNHostView matchContents>
							<View accessibilityLabel={item.label}>
								<Icon as={ChevronDown} size={18} color={colors.foreground} />
							</View>
						</RNHostView>
					</TextButton>
				</DropdownMenu.Trigger>
				<DropdownMenu.Items>
					{item.options.map((option) => (
						<DropdownMenuItem
							key={option.value}
							onClick={() => {
								setOpen(false);
								item.onChange(option.value);
							}}
						>
							<DropdownMenuItem.Text>
								<Text>{option.label}</Text>
							</DropdownMenuItem.Text>
							{option.value === item.value ? (
								<DropdownMenuItem.TrailingIcon>
									<RNHostView matchContents>
										<View>
											<Icon as={Check} size={20} color={colors.foreground} />
										</View>
									</RNHostView>
								</DropdownMenuItem.TrailingIcon>
							) : null}
						</DropdownMenuItem>
					))}
				</DropdownMenu.Items>
			</DropdownMenu>
		</Host>
	);
}
