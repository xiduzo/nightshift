/**
 * How Night Shift tells a person no. A refusal is an error written for
 * people: what happened, and how to fix it. Every other error is a
 * failure: the person sees `FAILURE_MESSAGE`, and the details go to the
 * log. The API answers a refusal with the status of its kind and its own
 * words (`@nightshift/api`), and a failure as a 500.
 *
 * It imports nothing, so every package can throw it, from `flows` up, and
 * the run rule (`@nightshift/engine/run-status`) can name it for the apps.
 */

export {
	FAILURE_MESSAGE,
	Refusal,
	type RefusalKind,
	wordsFor,
} from "./refusal";
