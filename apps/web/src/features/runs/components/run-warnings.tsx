import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { TriangleAlertIcon } from "lucide-react";

import type { RunDetail } from "@/shared/api";

/**
 * What went wrong in a run without failing a step, such as a step whose
 * cost is not known. Each warning names its step and can show it.
 */
export function RunWarnings({
	warnings,
	onShowStep,
}: {
	warnings: RunDetail["warnings"];
	onShowStep: (stepId: string) => void;
}) {
	if (warnings.length === 0) return null;
	return (
		<Alert>
			<TriangleAlertIcon className="text-status-waiting" />
			<AlertTitle>
				{warnings.length === 1 ? "1 warning" : `${warnings.length} warnings`}
			</AlertTitle>
			<AlertDescription>
				<ul className="flex w-full flex-col gap-2">
					{warnings.map((warning, index) => (
						<li
							// A step can warn twice with the same message.
							key={`${warning.stepId}-${warning.at}-${index}`}
							className="flex items-start gap-2"
						>
							<span className="min-w-0 flex-1">
								{warning.nodeId ? (
									<span className="font-medium font-mono text-foreground">
										{warning.nodeId}:{" "}
									</span>
								) : null}
								{warning.message}
							</span>
							{warning.stepId ? (
								<Button
									variant="link"
									size="xs"
									className="h-auto shrink-0 px-0"
									onClick={() => onShowStep(warning.stepId as string)}
								>
									Show step
								</Button>
							) : null}
						</li>
					))}
				</ul>
			</AlertDescription>
		</Alert>
	);
}
