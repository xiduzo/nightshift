import { Refusal } from "@nightshift/refusal";
import type { ArchiveRef, Caller } from "../contract";
import { forbidden, type HostExchangeDeps, STARTS_RUNS } from "./host-deps";
import type { HostExchange } from "./types";

/** The archive (`archive`): the files of runs walked elsewhere, the knowledge content, and live transcripts. */
export function hostArchive(
	deps: Pick<HostExchangeDeps, "engine" | "selfId">,
): Pick<
	HostExchange,
	| "archivePut"
	| "archiveGet"
	| "knowledgePut"
	| "knowledgeGet"
	| "archiveFollow"
	| "archiveTail"
> {
	const { engine } = deps;
	const { exchange } = engine;
	return {
		async archivePut(caller, { ref, content, stamp }) {
			await ownRun(caller, ref);
			await exchange.archive.write(ref, content, stamp);
		},

		async archiveGet(caller, { ref }) {
			const owner = await exchange.runOwner(ref.runId);
			if (
				!owner ||
				owner.spaceId !== ref.spaceId ||
				!(await caller.member(owner.spaceId))
			) {
				return null;
			}
			if (ref.kind !== "checkpoint") {
				const step = await exchange.stepOwner(ref.stepId);
				if (step?.runId !== ref.runId) return null;
			}
			// Its own files are the step as it is now. A copy of a step's file
			// of an earlier end is not there yet (`RunHistoryExchange.archive`).
			return owner.walkerId === deps.selfId
				? exchange.archive.own(ref)
				: exchange.archive.read(ref);
		},

		async knowledgePut(caller, { spaceId, sha256, content }) {
			if (!(await caller.member(spaceId))) {
				throw new Refusal("not-found", "That Space does not exist.");
			}
			await caller.may(spaceId, STARTS_RUNS);
			// A Space another Host keeps is not this Host's to keep.
			if ((await engine.hostSpaces.hostOf(spaceId)) !== null) {
				throw new Refusal(
					"unavailable",
					"This computer does not keep the knowledge of that Space.",
				);
			}
			await engine.archive.here.write({
				ref: { kind: "content", spaceId, sha256 },
				content: new Uint8Array(Buffer.from(content, "base64")),
			});
		},

		async knowledgeGet(caller, { spaceId, sha256 }) {
			if (
				!(await caller.member(spaceId)) ||
				(await engine.hostSpaces.hostOf(spaceId)) !== null
			) {
				return null;
			}
			const content = await engine.archive.here.read({
				kind: "content",
				spaceId,
				sha256,
			});
			return content ? Buffer.from(content).toString("base64") : null;
		},

		async *archiveFollow(caller, { step, afterSeq }, signal) {
			const owner = await exchange.runOwner(step.runId);
			const found = await exchange.stepOwner(step.stepId);
			if (
				!owner ||
				owner.spaceId !== step.spaceId ||
				found?.runId !== step.runId ||
				!(await caller.member(owner.spaceId))
			) {
				forbidden("You are not a member of the Space of this run.");
			}
			yield* exchange.feeds.follow(
				step,
				afterSeq,
				signal ?? new AbortController().signal,
			);
		},

		async archiveTail(caller, { step, entries, ended }) {
			await ownRun(caller, { kind: "transcript", ...step });
			exchange.feeds.deliver(caller.deviceId, step, entries, ended);
		},
	};

	/** The archive takes a run's files from its Walker only, in its owner's Spaces. */
	async function ownRun(caller: Caller, ref: ArchiveRef): Promise<void> {
		const owner = await exchange.runOwner(ref.runId);
		const step =
			ref.kind === "checkpoint" ? null : await exchange.stepOwner(ref.stepId);
		if (
			!owner ||
			owner.walkerId !== caller.deviceId ||
			owner.spaceId !== ref.spaceId ||
			(ref.kind !== "checkpoint" && step?.runId !== ref.runId) ||
			!(await caller.member(owner.spaceId))
		) {
			forbidden("A device may only archive the runs it walks.");
		}
	}
}
