/** One web request: what it names, how it goes out, and its answer. */

export { outgoing, requestSecretNames } from "./outgoing";
export { sendRequest } from "./send-request";
export type {
	RequestField,
	RequestPart,
	RequestText,
	WebRequestInput,
	WebRequestResult,
	WebResponse,
} from "./types";
