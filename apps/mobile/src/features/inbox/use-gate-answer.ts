import {
	createGateMutations,
	type GateRefusal,
	gateKey,
	type OpenGate,
	unreachableAnswerText,
	useLiveCache,
} from "@nightshift/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useHostQueries, useSignedIn } from "@/features/host";
import { dismissKey } from "@/features/push";
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

/**
 * The answer to one Gate: the chosen option, the note, the check that it
 * is you, and the send. A sent answer takes the Gate out of the inbox at
 * once and takes its notification away.
 */
export function useGateAnswer(
	gate: OpenGate,
	{
		onSent,
		onClosed,
	}: {
		/** The Host took the answer: keep the Gate on screen while the inbox drops it. */
		onSent: () => void;
		/** Night Shift refused the answer: the Gate closed in the meantime. */
		onClosed: () => void;
	},
) {
	const { host } = useSignedIn();
	const live = useLiveCache(host.orpc);
	const mutations = useHostQueries(createGateMutations);
	const [choice, setChoice] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [checking, setChecking] = useState(false);
	const [problem, setProblem] = useState<Problem | null>(null);
	const [sent, setSent] = useState<SentAnswer | null>(null);

	/** Takes this Gate out of the inbox at once; the refetch confirms it. */
	const dropGate = () => live.afterGateAnswered(gate);

	const resolve = useMutation(
		mutations.answer({
			onSuccess: (result, input) => {
				if (result.kind === "refused") {
					if (result.refusal === "closed") {
						onClosed();
						dropGate();
					} else {
						setProblem({ kind: "refused", refusal: result.refusal });
					}
					return;
				}
				setSent({ choice: input.choice, note: input.note ?? null });
				onSent();
				dropGate();
				void dismissKey(gateKey(gate)).catch(() => undefined);
			},
			onError: (error) => {
				const unreachable = unreachableAnswerText(error);
				setProblem(
					unreachable
						? { kind: "unreachable", text: unreachable }
						: { kind: "failed", message: error.message },
				);
			},
		}),
	);

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
