import type { OpenGate } from "../gates";
import type { RunSummary } from "../runs";

/**
 * What to tell the person about: a Gate opened, a run finished, a run
 * failed. Each app shows the notice its own way.
 */
export type Notice =
	| { kind: "gate-opened"; gate: OpenGate }
	| { kind: "run-finished"; run: RunSummary }
	| { kind: "run-failed"; run: RunSummary };

/** The words of a notice. */
export function describeNotice(notice: Notice): {
	title: string;
	body: string;
} {
	switch (notice.kind) {
		case "gate-opened":
			return {
				title: `${notice.gate.projectName}: a Gate waits for you`,
				body: `${notice.gate.runTitle}\n${notice.gate.question}`,
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
