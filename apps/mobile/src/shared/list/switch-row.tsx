import { Switch } from "@nightshift/ui-native/components/ui/switch";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Pressable, View } from "react-native";

/**
 * A setting in a ListGroup: its title, an optional muted line, and a
 * Switch at the end. The whole row is one switch of at least 44 pt: a tap
 * anywhere turns it on or off.
 */
export function SwitchRow({
	title,
	caption,
	checked,
	onChange,
	disabled,
}: {
	title: string;
	/** What the setting does, when the title does not say it all. */
	caption?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<Pressable
			onPress={() => onChange(!checked)}
			disabled={disabled}
			accessibilityRole="switch"
			accessibilityLabel={title}
			accessibilityHint={caption}
			accessibilityState={{ checked, disabled }}
			className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-accent"
		>
			<View className="flex-1 gap-0.5">
				<Text className="font-medium text-base">{title}</Text>
				{caption ? (
					<Text className="text-muted-foreground text-sm">{caption}</Text>
				) : null}
			</View>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				<Switch
					checked={checked}
					onCheckedChange={onChange}
					disabled={disabled}
				/>
			</View>
		</Pressable>
	);
}
