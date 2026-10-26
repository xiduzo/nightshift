import { gateParts, type OpenGate, plainText } from "../gates";
import { type RunSummary, runEndLine } from "../runs";

/** What a notice tells about: the Gate that opened, or the run that ended. */
type NoticeFacts =
	| { kind: "gate-opened"; gate: OpenGate }
	| {
			kind: "run-finished" | "run-failed";
			run: Pick<RunSummary, "title" | "reason" | "result">;
	  };

/**
 * The words of a notice: the project, the run and the question as plain
 * text, or the run and how it ended. A run an End node ended says its
 * result and message ("Nothing to do: No open issues").
 */
export function describeNotice(notice: NoticeFacts): {
	title: string;
	body: string;
} {
	if (notice.kind !== "gate-opened") {
		const end = runEndLine(notice.run);
		if (end !== null) {
			return {
				title:
					notice.run.result === "nothing-to-do"
						? "A run had nothing to do"
						: notice.kind === "run-failed"
							? "A run failed"
							: "A run finished",
				body: `${notice.run.title}\n${end}`,
			};
		}
	}
	switch (notice.kind) {
		case "gate-opened":
			return {
				title: `${notice.gate.projectName}: a Gate waits for you`,
				body: `${notice.gate.runTitle}\n${plainText(gateParts(notice.gate.question).headline)}`,
			};
		case "run-finished":
			return {
				title: "A run finished",
				body: notice.run.reason
					? `${notice.run.title}\nEnded on ${notice.run.reason}`
					: notice.run.title,
			};
		case "run-failed":
			return {
				title: "A run failed",
				body: notice.run.reason
					? `${notice.run.title}\n${notice.run.reason}`
					: notice.run.title,
			};
	}
}
