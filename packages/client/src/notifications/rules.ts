import type { OpenGate } from "../gates";
import type { RunSummary } from "../runs";

/**
 * What to tell the person about: a Gate opened, a run finished, a run
 * failed. Each app shows the notice its own way.
 */
export type Notice =
	| { kind: "gate-opened"; key: string; gate: OpenGate }
	| { kind: "run-finished"; run: RunSummary }
	| { kind: "run-failed"; run: RunSummary };

/**
 * The words of a notice, and its tag: a second notice with the same tag
 * replaces the first.
 */
export function describeNotice(notice: Notice): {
	title: string;
	body: string;
	tag: string;
} {
	switch (notice.kind) {
		case "gate-opened":
			return {
				title: `${notice.gate.projectName}: a Gate waits for you`,
				body: `${notice.gate.runTitle}\n${notice.gate.question}`,
				tag: `gate:${notice.key}`,
			};
		case "run-finished":
			return {
				title: "A run finished",
				body: notice.run.reason
					? `${notice.run.title}\nEnded on ${notice.run.reason}`
					: notice.run.title,
				tag: `run:${notice.run.id}:${notice.run.status}`,
			};
		case "run-failed":
			return {
				title: "A run failed",
				body: notice.run.reason
					? `${notice.run.title}\n${notice.run.reason}`
					: notice.run.title,
				tag: `run:${notice.run.id}:${notice.run.status}`,
			};
	}
}
