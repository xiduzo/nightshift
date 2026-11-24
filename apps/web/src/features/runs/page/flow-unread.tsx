import { flowUnreadWords } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { HistoryIcon } from "lucide-react";

import type { RunDetail } from "@/shared/api";

/** Says why the run has no flow to show, and what is left to read. */
export function FlowUnread({ run }: { run: RunDetail }) {
	const words = flowUnreadWords(run);
	if (!words) return null;
	return (
		<Alert>
			<HistoryIcon />
			<AlertTitle>{words.title}</AlertTitle>
			<AlertDescription>{words.body}</AlertDescription>
		</Alert>
	);
}
