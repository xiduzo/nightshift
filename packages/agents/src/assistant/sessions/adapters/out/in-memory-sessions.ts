import type { AssistantSessionEvent } from "../../domain/session";
import type { Sessions } from "../../wire";

type Ask = Parameters<Sessions["runSession"]>[0];
type ReportAsk = Parameters<Sessions["runReport"]>[1];

/**
 * Sessions that play a script: the events of each call, in order. The last
 * script answers every later call. `asked` holds what each call was asked.
 */
export function inMemorySessions(...scripts: AssistantSessionEvent[][]) {
	const asked: ReportAsk[] = [];
	const sessions: Ask[] = [];
	const play = (call: number) =>
		(async function* () {
			yield* scripts[Math.min(call, scripts.length) - 1] ?? [];
		})();
	return {
		asked,
		sessions,
		runSession(input: Ask) {
			return play(sessions.push(input));
		},
		runReport(_via: Parameters<Sessions["runReport"]>[0], input: ReportAsk) {
			return play(asked.push(input));
		},
	} satisfies Sessions & { asked: ReportAsk[]; sessions: Ask[] };
}
