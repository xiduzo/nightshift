import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { View } from "react-native";

import { iconOf, StatusBadge } from "@/shared/status";
import { TONE_CLASS } from "@/shared/tone";
import { type TrailItem, trailItemLabel } from "./trail-items";

/**
 * The steps of a run as a timeline: per step its kind's icon on a muted
 * circle, a line to the next step, the node's name in mono, its badge,
 * what happened and "4 min · $0.12". Each step is one element for a
 * screen reader. Build the items with `trailItemOf`.
 */
export function StepTrail({ items }: { items: readonly TrailItem[] }) {
	return (
		<View>
			{items.map((item, index) => {
				const last = index === items.length - 1;
				return (
					<View
						key={item.id}
						accessible
						accessibilityLabel={trailItemLabel(item)}
						className="flex-row gap-3"
					>
						<View className="items-center">
							<View
								className={cn(
									"size-8 items-center justify-center rounded-full",
									item.waiting ? "bg-status-waiting/15" : "bg-muted",
								)}
							>
								<Icon
									as={iconOf(item.kind.icon)}
									className={cn(
										"size-4",
										item.waiting
											? TONE_CLASS.waiting.text
											: "text-muted-foreground",
									)}
								/>
							</View>
							{last ? null : <View className="my-1 w-px flex-1 bg-border" />}
						</View>
						<View className={cn("flex-1 gap-1 pt-1", last ? "pb-0" : "pb-4")}>
							<View className="flex-row flex-wrap items-center gap-2">
								<Text className="flex-shrink font-mono font-semibold text-sm">
									{item.label}
								</Text>
								<StatusBadge look={item.look} />
							</View>
							{item.detail ? (
								<Text className="text-muted-foreground text-sm">
									{item.detail}
								</Text>
							) : null}
							{item.meta ? (
								<Text className="text-muted-foreground text-xs">
									{item.meta}
								</Text>
							) : null}
						</View>
					</View>
				);
			})}
		</View>
	);
}
