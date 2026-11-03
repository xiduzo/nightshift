/**
 * Why a run failed, short enough for one line: the step it names, and the
 * first sentence of the rest, without the output a reason may carry.
 */
export function shortReason(reason: string | null): {
	/** The node the reason names (`Node "write" failed: …`), else null. */
	step: string | null;
	/** Null when the run gave no reason. */
	short: string | null;
} {
	const raw = reason?.trim();
	if (!raw) return { step: null, short: null };
	const node = raw.match(/^Node "([^"]+)" (failed: )?(.*)$/s);
	const rest = node ? (node[3] ?? "") : raw;
	// The first line, before any output pasted into it (`| 84 |`, `"""`).
	const line = (rest.split(/\n| \| |"""/)[0] ?? rest).trim();
	const sentence = line.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? line;
	const short = sentence.replace(/[:;,]\s*$/, "").trim();
	return { step: node?.[1] ?? null, short: short || raw };
}
