import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { webhookAuthentic } from "./webhook-proof";

const SECRET = "s3cret";

const body = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value));

/** A request as GitHub signs it, or with other headers. */
function signed(
	payload: Uint8Array,
	headers: Record<string, string> = {},
	secret = SECRET,
): Headers {
	return new Headers({
		"content-type": "application/json",
		"x-github-event": "pull_request",
		"x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
		...headers,
	});
}

describe("webhookAuthentic", () => {
	const payload = body({ a: 1 });

	test("takes GitHub's signature or a bearer secret, and nothing else", () => {
		expect(webhookAuthentic(signed(payload), payload, SECRET)).toBe(true);
		expect(webhookAuthentic(signed(payload), body({ a: 2 }), SECRET)).toBe(
			false,
		);
		expect(
			webhookAuthentic(signed(payload, {}, "other"), payload, SECRET),
		).toBe(false);
		const bearer = (value: string) =>
			webhookAuthentic(new Headers({ authorization: value }), payload, SECRET);
		expect(bearer(`Bearer ${SECRET}`)).toBe(true);
		expect(bearer(`bearer ${SECRET}`)).toBe(true);
		expect(bearer("Bearer s3cre")).toBe(false);
		expect(bearer(SECRET)).toBe(false);
		expect(webhookAuthentic(new Headers(), payload, SECRET)).toBe(false);
	});

	test("takes the signature of the curl example in docs/deploy/triggers.md", () => {
		// `printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET"` gives this hex.
		const sent = new TextEncoder().encode(
			'{"event":"workflow_dispatch","ref":"main"}',
		);
		const headers = new Headers({
			"x-hub-signature-256":
				"sha256=c98cccfa6a826fa62986e44f9d6f1415f5cda15491c5e96a1f29f8bd1e9fcba5",
		});
		expect(webhookAuthentic(headers, sent, SECRET)).toBe(true);
	});
});
