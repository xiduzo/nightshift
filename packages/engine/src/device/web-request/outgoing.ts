import type { OutgoingRequest } from "./send-request";
import type { RequestText, WebRequestInput } from "./types";

/** The secrets a request names, each once. */
export function requestSecretNames(
	input: Omit<WebRequestInput, "signal" | "run">,
): string[] {
	const texts: RequestText[] = [
		input.url,
		...(input.query ?? []).map((field) => field.value),
		...(input.headers ?? []).map((field) => field.value),
		...(input.body === undefined
			? []
			: input.body.kind === "text"
				? [input.body.text]
				: input.body.fields.map((field) => field.value)),
	];
	return [
		...new Set(
			texts.flatMap((text) =>
				text.flatMap((part) => ("secret" in part ? [part.secret] : [])),
			),
		),
	];
}

/** A request text with its secrets filled in. */
function filled(text: RequestText, env: Record<string, string>): string {
	return text
		.map((part) => {
			if ("text" in part) return part.text;
			const value = env[part.secret] ?? "";
			return part.escape === "json"
				? JSON.stringify(value).slice(1, -1)
				: value;
		})
		.join("");
}

/** Whether a text holds a secret. */
function holdsSecret(text: RequestText): boolean {
	return text.some((part) => "secret" in part);
}

/** The request as it goes out: every secret filled in, the query on the URL, the form encoded. */
export function outgoing(
	input: Omit<WebRequestInput, "run">,
	env: Record<string, string>,
): OutgoingRequest {
	let url = filled(input.url, env);
	const query = (input.query ?? []).map(
		(field) => [field.name, filled(field.value, env)] as [string, string],
	);
	if (query.length > 0) {
		try {
			const parsed = new URL(url);
			for (const [name, value] of query)
				parsed.searchParams.append(name, value);
			url = parsed.toString();
		} catch {
			// Not a URL: `sendRequest` refuses it.
		}
	}
	const body = input.body;
	return {
		method: input.method,
		url,
		headers: (input.headers ?? []).map((field) => ({
			name: field.name,
			value: filled(field.value, env),
			secret: holdsSecret(field.value),
		})),
		...(body === undefined
			? {}
			: body.kind === "text"
				? {
						body: {
							contentType: body.contentType,
							text: filled(body.text, env),
						},
					}
				: {
						body: {
							contentType: "application/x-www-form-urlencoded",
							text: new URLSearchParams(
								body.fields.map((field): [string, string] => [
									field.name,
									filled(field.value, env),
								]),
							).toString(),
						},
					}),
		timeoutMs: input.timeoutMs,
		maxBytes: input.maxBytes,
		showHost: !holdsSecret(input.url),
		signal: input.signal,
	};
}
