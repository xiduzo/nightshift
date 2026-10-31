import { type OpenGate, webPathOf } from "@nightshift/client";
import type { AskAttachment, AskForm, JsonValue } from "@nightshift/flows";

/**
 * What the phone shows of an Ask (ADR 10). Pure: `ask-screen.tsx` draws
 * it.
 */

/** The Ask's page in Night Shift on the web, at the Host this phone talks to. */
export function askWebUrl(
	address: string,
	gate: Pick<OpenGate, "runId" | "stepId">,
): string {
	return `${address}${webPathOf({ to: "gate", runId: gate.runId, stepId: gate.stepId })}`;
}

/**
 * Where an image of the Ask loads from: the Host serves the files of the
 * runs it walks. Null for a link, a file that is no image, or a run
 * another computer walks: the phone then shows only the name.
 */
export function askImageUrl(
	address: string,
	runId: string,
	attachment: AskAttachment,
	walkedHere: boolean,
): string | null {
	const { artifactId, mediaType } = attachment;
	if (!walkedHere || artifactId === undefined) return null;
	if (!(mediaType ?? "").startsWith("image/")) return null;
	return `${address}/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The answer in a few words, for the card after the send: the labels of
 * the run's choices that were chosen, else "Your answers".
 */
export function askSentSummary(
	form: AskForm,
	data: JsonValue | undefined,
): string {
	const { choices } = form;
	if (choices && isRecord(data)) {
		const chosen = data[choices.field];
		const names = Array.isArray(chosen) ? chosen : [chosen];
		const labels = choices.items
			.filter((item) => names.includes(item.name))
			.map((item) => item.label);
		if (labels.length > 0) return labels.join(", ");
	}
	return "Your answers";
}
