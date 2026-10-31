import { gateRefusalText } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { CircleAlert } from "lucide-react-native";

import { CHECK_COPY } from "./answer-check";
import type { Problem } from "./use-gate-answer";

/** Why the last answer did not go: the check of the person, a refusal, an unreachable Host, or a failure. */
export function ProblemAlert({ problem }: { problem: Problem }) {
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
		<Alert icon={CircleAlert} variant="destructive">
			<AlertTitle>{copy.title}</AlertTitle>
			<AlertDescription>{copy.description}</AlertDescription>
		</Alert>
	);
}
