import {
	isDocument,
	LOCAL_ONLY_BYTES,
	loadDocumentContent,
} from "../../../../file-loaders";
import type { ContentTexts } from "../../application/ports";
import { cleanPath } from "../../domain/paths";
import {
	documentResult,
	textResult,
	textResultFrom,
	tooLarge,
} from "../../domain/text";

/** The text of a file from its content, over the loaders of PDF and Word files. */
export function fileLoadersContentTexts(): ContentTexts {
	return {
		async text(path, content, maxBytes, from) {
			const clean = cleanPath(path);
			if (clean === null) return null;
			const bytes = Math.max(1, maxBytes);
			if (isDocument(clean)) {
				if (content.length > LOCAL_ONLY_BYTES) throw tooLarge(clean);
				return documentResult(
					clean,
					await loadDocumentContent(clean, content),
					bytes,
					from,
				);
			}
			if (from) {
				const whole = Buffer.from(
					content.subarray(0, LOCAL_ONLY_BYTES),
				).toString("utf8");
				return textResultFrom(clean, whole, content.length, bytes, from);
			}
			const start = Buffer.from(content.subarray(0, bytes)).toString("utf8");
			return textResult(clean, start, content.length, bytes);
		},
	};
}
