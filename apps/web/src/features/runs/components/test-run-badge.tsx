import {
	standInLabel,
	TEST_RUN_HINT,
	TEST_RUN_LABEL,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { FlaskConicalIcon, PinIcon, SkipForwardIcon } from "lucide-react";
import type { StepSummary } from "@/shared/api";

/**
 * A test run (ADR 27): a person started it from the editor with pinned or
 * skipped nodes. Only its spend counts in the numbers.
 */
export function TestRunBadge({ className }: { className?: string }) {
	return (
		<Badge variant="outline" className={className} title={TEST_RUN_HINT}>
			<FlaskConicalIcon aria-hidden="true" />
			{TEST_RUN_LABEL}
		</Badge>
	);
}

/** A step of a test run that stood in for its node: a pinned output, or a skip. */
export function StandInBadge({
	test,
}: {
	test: NonNullable<StepSummary["test"]>;
}) {
	const Icon = test === "pinned" ? PinIcon : SkipForwardIcon;
	return (
		<Badge variant="outline">
			<Icon aria-hidden="true" />
			{standInLabel(test)}
		</Badge>
	);
}
