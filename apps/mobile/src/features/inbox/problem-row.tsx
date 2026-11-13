import { gateRefusalText } from "@nightshift/client";
import { CircleAlert } from "lucide-react-native";

import { NativeTextRow } from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import { CHECK_COPY } from "./answer-check";
import type { Problem } from "./use-gate-answer";

/** Why the last answer did not go: the check of the person, a refusal, an unreachable Host, or a failure. */
export function ProblemRow({ problem }: { problem: Problem }) {
	const { colors } = useThemeColors();
	const copy =
		problem.kind === "check"
			? CHECK_COPY[problem.failure]
			: problem.kind === "refused"
				? gateRefusalText(problem.refusal)
				: problem.kind === "unreachable"
					? problem.text
					: {
							title: "Your answer was not sent",
							description: `${problem.message} Check that this phone is online. Then send it again.`,
						};
	return (
		<NativeTextRow
			icon={{ sf: "exclamationmark.circle.fill", lucide: CircleAlert }}
			iconColor={colors.destructive}
			text={`**${copy.title}**`}
			note={copy.description}
		/>
	);
}
