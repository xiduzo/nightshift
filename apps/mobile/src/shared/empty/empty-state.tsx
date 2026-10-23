import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

type EmptyStateProps = {
	icon: LucideIcon;
	title: string;
	description: string;
	/** What the person can do now: usually one Button. */
	children?: ReactNode;
};

/**
 * Nothing here yet: what this place is for, and how to start. The shadcn
 * Empty block, built from React Native Reusables parts (it has no Empty).
 */
export function EmptyState({
	icon,
	title,
	description,
	children,
}: EmptyStateProps) {
	return (
		<View className="flex-1 items-center justify-center gap-4 px-8 py-12">
			<View className="size-12 items-center justify-center rounded-lg bg-muted">
				<Icon as={icon} className="size-6 text-muted-foreground" />
			</View>
			<View className="items-center gap-2">
				<Text variant="large" className="text-center">
					{title}
				</Text>
				<Text variant="muted" className="text-center text-muted-foreground">
					{description}
				</Text>
			</View>
			{children}
		</View>
	);
}
