import {
	type ChoiceRoute,
	choiceLine,
	type GateChoice,
	routeNote,
	routeText,
} from "@nightshift/client";

import { NativeOptionRow, NativeSection } from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import { OUTCOME_HEX } from "@/shared/tone";

/**
 * The options of a Gate (or of a run that stopped) as one group of rows
 * to pick from: each with its name in its flow color, "Recommended" on
 * the option the flow recommends, what happens when you pick it (or else
 * its description) and where it leads. A red option stops work. Tapping a row chooses it. The bar sends it.
 */
export function ChoiceSection({
	title,
	footer,
	choices,
	routes,
	chosen,
	recommended = null,
	onChoose,
	disabled,
}: {
	title: string;
	footer?: string;
	choices: readonly GateChoice[];
	routes: ReadonlyMap<string, ChoiceRoute>;
	chosen: string | null;
	/** The name of the option the flow recommends. */
	recommended?: string | null;
	onChoose: (name: string) => void;
	disabled: boolean;
}) {
	const { scheme } = useThemeColors();
	return (
		<NativeSection title={title} footer={footer}>
			{choices.map((choice) => {
				const route = routes.get(choice.name);
				const subtitle = [
					choiceLine(choice),
					routeText(route),
					routeNote(route),
				]
					.filter(Boolean)
					.join("\n");
				return (
					<NativeOptionRow
						key={choice.name}
						title={choice.name}
						subtitle={subtitle === "" ? undefined : subtitle}
						color={choice.color ? OUTCOME_HEX[scheme][choice.color] : undefined}
						selected={chosen === choice.name}
						recommended={recommended === choice.name}
						disabled={disabled}
						onPress={() => onChoose(choice.name)}
					/>
				);
			})}
		</NativeSection>
	);
}
