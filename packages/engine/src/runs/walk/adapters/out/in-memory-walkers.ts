import type {
	Actor,
	RunCommandInput,
	RunCommandKind,
} from "../../../../contract";
import { personOf } from "../../../../contract";
import type { RunRow } from "../../../../log";
import { RunRefusal } from "../../../../run-status";
import type { Walkers } from "../../application/ports";

/** A Command as the twin keeps it: what the Host would carry to the Walker. */
export type SentCommand = RunCommandInput & {
	spaceId: string;
	runId: string;
	walkerId: string;
	personId: string;
};

/**
 * The Walkers of runs in memory. It records each Command it was handed,
 * and a Command waits for its Walker until the test says it was applied
 * (`done`). Without a Host to reach (`reachable: false`) it refuses as
 * the real one does.
 */
export function inMemoryWalkers(options: { reachable?: boolean } = {}) {
	const reachable = options.reachable ?? true;
	const waiting: SentCommand[] = [];

	const twin = {
		/** Every Command sent, in order. */
		sent: [] as SentCommand[],
		/** The Walker applied the run's Commands: they wait no more. */
		done(runId: string) {
			for (let i = waiting.length - 1; i >= 0; i--) {
				if (waiting[i]?.runId === runId) waiting.splice(i, 1);
			}
		},

		async send(
			run: Pick<RunRow, "id" | "spaceId" | "walkerId">,
			actor: Actor,
			command: RunCommandInput,
		) {
			if (!reachable) {
				throw new RunRefusal(
					"walker-unreachable",
					"Another device runs this run, and this computer cannot reach it.",
				);
			}
			const personId = personOf(actor);
			if (personId === null) {
				throw new RunRefusal("signed-out", "Sign in to act on this run.");
			}
			const sent = {
				...command,
				spaceId: run.spaceId,
				runId: run.id,
				walkerId: run.walkerId,
				personId,
			};
			twin.sent.push(sent);
			waiting.push(sent);
		},
		async pending(runId: string): Promise<readonly RunCommandKind[]> {
			return waiting.filter((c) => c.runId === runId).map((c) => c.kind);
		},
	};
	return twin satisfies Walkers;
}

export type InMemoryWalkers = ReturnType<typeof inMemoryWalkers>;
