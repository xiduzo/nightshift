import {
	type GateRefusal,
	type OpenGate,
	unreachableAnswerText,
	useAnswerGate,
} from "@nightshift/client";
import { useState } from "react";

import { useSignedIn } from "@/features/host";
import type { CheckFailure } from "./answer-check";
import { checkBeforeAnswer } from "./person-check";

/** What went wrong with the last answer. */
export type Problem =
	| { kind: "check"; failure: CheckFailure }
	| { kind: "refused"; refusal: GateRefusal }
	/** The Host of the Space cannot be reached now: the Gate still waits. */
	| { kind: "unreachable"; text: { title: string; description: string } }
	| { kind: "failed"; message: string };

/** The answer that went out. */
export type SentAnswer = { choice: string; note: string | null };

/** Why the Gate left: it closed in the meantime, or it is not in your Spaces. */
export type GoneRefusal = Extract<GateRefusal, "closed" | "not-found">;

/**
 * The answer to one Gate: the chosen option, the note, the check that it
 * is you, and the send. Whether the Gate leaves the inbox, and its
 * notification goes, is the live cache's rule (`useAnswerGate`).
 */
export function useGateAnswer(
	gate: OpenGate,
	{
		onSent,
		onGone,
	}: {
		/** The Host took the answer: keep the Gate on screen while the inbox drops it. */
		onSent: () => void;
		/** Night Shift refused the answer: the Gate closed in the meantime, or is not in your Spaces. */
		onGone: (refusal: GoneRefusal) => void;
	},
) {
	const { host } = useSignedIn();
	const [choice, setChoice] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [checking, setChecking] = useState(false);
	const [problem, setProblem] = useState<Problem | null>(null);
	const [sent, setSent] = useState<SentAnswer | null>(null);

	const resolve = useAnswerGate(host, {
		onSuccess: (result, input) => {
			if (result.kind === "answered") {
				setSent({ choice: input.choice, note: input.note ?? null });
				onSent();
			} else if (
				result.refusal === "closed" ||
				result.refusal === "not-found"
			) {
				onGone(result.refusal);
			} else {
				setProblem({ kind: "refused", refusal: result.refusal });
			}
		},
		onError: (error) => {
			const unreachable = unreachableAnswerText(error);
			setProblem(
				unreachable
					? { kind: "unreachable", text: unreachable }
					: { kind: "failed", message: error.message },
			);
		},
	});

	const busy = checking || resolve.isPending || sent !== null;

	function choose(name: string) {
		if (busy) return;
		setProblem(null);
		setChoice(name);
	}

	/** Checks that it is you (unless the Gate is for the lock screen), then sends. */
	async function send() {
		if (busy || choice === null) return;
		setProblem(null);
		setChecking(true);
		const failure = await checkBeforeAnswer(gate).finally(() =>
			setChecking(false),
		);
		if (failure) {
			setProblem({ kind: "check", failure });
			return;
		}
		const trimmed = note.trim();
		resolve.mutate({
			runId: gate.runId,
			stepId: gate.stepId,
			choice,
			note: trimmed === "" ? undefined : trimmed,
		});
	}

	return {
		choice,
		choose,
		note,
		setNote,
		send,
		checking,
		sending: resolve.isPending,
		busy,
		problem,
		sent,
	};
}

export type GateAnswerState = ReturnType<typeof useGateAnswer>;
