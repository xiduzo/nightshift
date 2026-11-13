import { Card } from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { View } from "react-native";

import { StatusText } from "@/shared/status";
import type { Look } from "@/shared/tone";

/**
 * One fact of a FactGrid: a small muted label, the value, an optional sub
 * line and status. "Branch / nightshift/run-42" (mono), "Cost / $0.42".
 */
export function FactTile({
	label,
	value,
	sub,
	mono,
	look,
}: {
	/** A row of its own in a FactGrid, for a long value. */
	wide?: boolean;
	label: string;
	value: string;
	/** A muted line under the value: "of $2.00 so far". */
	sub?: string;
	/** For an id, a branch or a command. */
	mono?: boolean;
	/** A status under the value, as an icon and a word. */
	look?: Look;
}) {
	return (
		<View
			accessible
			accessibilityLabel={[label, value, sub, look?.label]
				.filter(Boolean)
				.join(", ")}
			className="flex-1"
		>
			<Card className="flex-1 gap-1 px-4 py-3">
				<Text className="text-muted-foreground text-xs">{label}</Text>
				<Text
					selectable
					className={cn(
						"font-semibold",
						mono ? "font-mono text-sm" : "text-base",
					)}
				>
					{value}
				</Text>
				{sub ? (
					<Text className="text-muted-foreground text-xs">{sub}</Text>
				) : null}
				{look ? <StatusText look={look} /> : null}
			</Card>
		</View>
	);
}
