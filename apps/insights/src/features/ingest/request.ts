import {
	INGEST_RULE,
	type IngestRule,
	type InsightsDb,
	ingestLogs,
} from "@nightshift/insights";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * The ingest route. A body over 256 KB is refused. The country is the
 * CF-IPCountry header when it is a two-letter code, and null otherwise.
 * No address is read or logged.
 */
export async function ingestRequest(
	db: InsightsDb,
	request: Request,
): Promise<Response> {
	const declared = request.headers.get("content-length");
	if (declared !== null) {
		const size = Number(declared);
		if (Number.isFinite(size) && size > MAX_BODY_BYTES) return tooLarge();
	}
	const bytes = await readLimited(request);
	if (!bytes) return tooLarge();
	let payload: unknown;
	try {
		payload = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return invalid();
	}
	try {
		const result = await ingestLogs(db, payload, {
			country: countryOf(request),
		});
		if (result.refused === 0) return Response.json({});
		return Response.json({
			partialSuccess: {
				rejectedLogRecords: result.refused,
				errorMessage: result.refusals
					.map((item) => ruleOf(item.rule))
					.join(", "),
			},
		});
	} catch {
		return invalid();
	}
}

function countryOf(request: Request): string | null {
	const header = request.headers.get("cf-ipcountry");
	if (!header || !/^[A-Za-z]{2}$/.test(header)) return null;
	return header.toUpperCase();
}

function ruleOf(rule: string): IngestRule {
	if (rule === INGEST_RULE.unknownAttribute)
		return INGEST_RULE.unknownAttribute;
	if (rule === INGEST_RULE.wrongType) return INGEST_RULE.wrongType;
	return INGEST_RULE.unknownEvent;
}

async function readLimited(request: Request): Promise<Uint8Array | null> {
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
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

function tooLarge(): Response {
	return Response.json({ message: "The body is too large." }, { status: 413 });
}

function invalid(): Response {
	return Response.json({ message: "The body is not valid." }, { status: 400 });
}
