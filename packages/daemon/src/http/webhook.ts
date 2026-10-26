import type { Engine, WebhookAnswer } from "@nightshift/engine";

/**
 * A webhook for a schedule: `POST /hooks/<project id>/<schedule id>`. The
 * one address of the daemon anyone may call without a session, so it does
 * little before the engine decides: it caps the body and hands the request
 * over (`Engine.webhook`). It answers at once (202), and the run starts
 * after. It never logs the body or a header: they may hold the secret.
 */

/** The most a webhook's body may hold. GitHub's are far smaller. */
export const WEBHOOK_MAX_BYTES = 1024 * 1024;

/** The body, or null when it holds more than `max` bytes. */
async function cappedBody(
	request: Request,
	max: number,
): Promise<Uint8Array | null> {
	const length = Number(request.headers.get("content-length") ?? "");
	if (Number.isFinite(length) && length > max) return null;
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		// The rest is left unread: the answer goes out now.
		if (total > max) return null;
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

const json = (body: unknown, status: number) =>
	Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** What the sender reads. A refusal before the secret checked out never says whether the schedule exists. */
function answerResponse(answer: WebhookAnswer): Response {
	switch (answer.kind) {
		case "accepted":
		case "filtered":
			return json({ result: answer.kind }, 202);
		case "refused":
			return json({ message: answer.reason }, 409);
		case "not-found":
			return json({ message: "Not found." }, 404);
	}
}

/**
 * Answers one webhook. The work after the answer (the run's start, the
 * signal) goes on in the background; its failure is logged without the
 * request.
 */
export async function webhookResponse(
	engine: Pick<Engine, "webhook">,
	request: Request,
	ids: { projectId: string; scheduleId: string },
	max = WEBHOOK_MAX_BYTES,
): Promise<Response> {
	const body = await cappedBody(request, max);
	if (body === null) {
		return json({ message: "The body is too large." }, 413);
	}
	const { answer, done } = await engine.webhook({
		...ids,
		headers: request.headers,
		body,
	});
	done.catch((error) =>
		console.error(
			`[webhooks] the webhook of schedule ${ids.scheduleId} failed:`,
			error instanceof Error ? error.message : error,
		),
	);
	return answerResponse(answer);
}
