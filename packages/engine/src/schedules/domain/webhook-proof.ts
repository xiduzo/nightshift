import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The proof of a webhook: the sender shows that it knows the schedule's
 * secret. Both ways compare in constant time. A pure computation: the
 * same request and secret always give the same answer.
 */

/** Whether two texts are equal, in a time that does not depend on where they differ. */
function sameText(a: string, b: string): boolean {
	const digest = (text: string) => createHash("sha256").update(text).digest();
	return timingSafeEqual(digest(a), digest(b));
}

/**
 * Whether the request proves it knows `secret`: GitHub's
 * `X-Hub-Signature-256: sha256=<hmac of the body>`, else
 * `Authorization: Bearer <secret>`.
 */
export function webhookAuthentic(
	headers: Headers,
	body: Uint8Array,
	secret: string,
): boolean {
	const signature = headers.get("x-hub-signature-256");
	if (signature !== null) {
		const expected = createHmac("sha256", secret).update(body).digest("hex");
		return sameText(signature.trim(), `sha256=${expected}`);
	}
	const bearer = /^Bearer\s+(\S.*)$/i.exec(
		headers.get("authorization")?.trim() ?? "",
	)?.[1];
	return bearer !== undefined && sameText(bearer, secret);
}
