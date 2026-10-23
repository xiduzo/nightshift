import type { ChoiceRoute, GateChoice } from "@nightshift/client";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui-native/components/ui/radio-group";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { ArrowRight, CircleStop, TriangleAlert } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { isDestructive, routeText } from "./gate-view";

/**
 * The options of a Gate as cards in a RadioGroup: each with its name, its
 * description and where it leads. A red option shows in the destructive
 * color. Tapping a card chooses it; the bar at the bottom sends it.
 */
export function ChoiceCards({
	choices,
	routes,
	chosen,
	onChoose,
	disabled,
}: {
	choices: readonly GateChoice[];
	routes: ReadonlyMap<string, ChoiceRoute>;
	chosen: string | null;
	onChoose: (name: string) => void;
	disabled: boolean;
}) {
	return (
		<RadioGroup
			value={chosen ?? undefined}
			onValueChange={onChoose}
			disabled={disabled}
			accessibilityLabel="Your answer"
		>
			{choices.map((choice) => (
				<ChoiceCard
					key={choice.name}
					choice={choice}
					route={routes.get(choice.name)}
					selected={chosen === choice.name}
					onPress={() => onChoose(choice.name)}
					disabled={disabled}
				/>
			))}
		</RadioGroup>
	);
}

function ChoiceCard({
	choice,
	route,
	selected,
	onPress,
	disabled,
}: {
	choice: GateChoice;
	route: ChoiceRoute | undefined;
	selected: boolean;
	onPress: () => void;
	disabled: boolean;
}) {
	const destructive = isDestructive(choice);
	const ends = route?.kind === "end" || route?.kind === "limit";
	// "Ends the run" shows as the badge.
	const next = route?.kind === "end" ? null : routeText(route);
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			accessibilityRole="radio"
			accessibilityState={{ checked: selected, disabled }}
			accessibilityLabel={[choice.name, choice.description, routeText(route)]
				.filter(Boolean)
				.join(", ")}
		>
			<Card
				className={cn(
					"flex-row gap-3 px-4 py-4",
					selected &&
						(destructive
							? "border-destructive bg-destructive/5"
							: "border-primary bg-accent"),
					disabled && !selected && "opacity-50",
				)}
			>
				<View className="flex-1 gap-1.5">
					<View className="flex-row items-start gap-1.5">
						{destructive ? (
							<Icon
								as={TriangleAlert}
								className="mt-0.5 size-4 text-destructive"
							/>
						) : null}
						<Text
							className={cn(
								"flex-shrink font-semibold text-base",
								destructive && "text-destructive",
							)}
						>
							{choice.name}
						</Text>
					</View>
					{choice.description ? (
						<Text className="text-muted-foreground text-sm">
							{choice.description}
						</Text>
					) : null}
					{next ? (
						<View className="flex-row items-start gap-1.5">
							<Icon
								as={ArrowRight}
								className="mt-0.5 size-4 text-muted-foreground"
							/>
							<Text className="flex-shrink text-sm">{next}</Text>
						</View>
					) : null}
					{ends ? (
						<Badge
							variant="outline"
							className={cn(
								"mt-1 self-start",
								destructive && "border-destructive/40 bg-destructive/10",
							)}
						>
							<Icon
								as={CircleStop}
								className={cn(
									"size-3",
									destructive ? "text-destructive" : "text-muted-foreground",
								)}
							/>
							<Text className={cn(destructive && "text-destructive")}>
								Ends the run
							</Text>
						</Badge>
					) : null}
				</View>
				<View
					pointerEvents="none"
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					className="pt-0.5"
				>
					<RadioGroupItem
						value={choice.name}
						className={cn(
							"size-5",
							selected &&
								(destructive ? "border-destructive" : "border-primary"),
						)}
					/>
				</View>
			</Card>
		</Pressable>
	);
}
