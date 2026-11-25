import type { JsonValue, WebRequestMethod } from "@nightshift/flows";
import type { StepRun } from "../../contract";

/**
 * One part of a text a request sends: text as it is, or a secret by name
 * that the Device fills in. `escape: "json"`: the value goes inside a
 * JSON string, escaped. Only a node's own text has secret parts: a value
 * a template renders is always text.
 */
export type RequestPart =
	| { text: string }
	| { secret: string; escape?: "json" };

/** A text a request sends, as its parts. */
export type RequestText = readonly RequestPart[];

/** A name and its text: a query value, a header, a form field. */
export type RequestField = { name: string; value: RequestText };

export type WebRequestInput = {
	method: WebRequestMethod;
	/** The whole URL. A secret part that is the whole URL keeps it out of every message. */
	url: RequestText;
	/** Added to the URL's query, in order. */
	query?: readonly RequestField[];
	headers?: readonly RequestField[];
	/** `text`: sent as `contentType`. `form`: sent as a URL-encoded form. */
	body?:
		| { kind: "text"; contentType: string; text: RequestText }
		| { kind: "form"; fields: readonly RequestField[] };
	timeoutMs: number;
	/** The most of the answer's body the Device keeps; a larger body fails. */
	maxBytes: number;
	/**
	 * The run the step works for. The Device reads that run's Project
	 * secrets for it (ADR 13). A Device that serves a call over the wire
	 * sets it from the call's own run, after the wire.
	 */
	run?: StepRun;
	signal: AbortSignal;
};

/** An answer, with the values of the secrets the request used masked. */
export type WebResponse = {
	status: number;
	statusText: string;
	/** By lower-case name; a repeated header joined with ", ". */
	headers: Record<string, string>;
	/** The JSON of a body the server says is JSON, else its text ("" for none). */
	body: JsonValue;
	/** The size of the body in bytes. */
	bytes: number;
};

export type WebRequestResult =
	/** Nothing was sent: a secret is not saved, the URL is not valid, or its address is not allowed here. */
	| { kind: "refused"; message: string }
	| { kind: "answered"; response: WebResponse }
	/**
	 * It was sent, but no answer the step can use came back. `network`: the
	 * server could not be reached or did not answer in time. Else the answer
	 * was too large, or a redirect went wrong.
	 */
	| { kind: "failed"; message: string; network: boolean };
