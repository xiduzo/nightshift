/**
 * Tiny neutral PDF and Word files, made in code: the fixtures of the
 * knowledge's document text. No file of anyone's goes in the repository.
 */
import { crc32 } from "node:zlib";

/** A one-page PDF with these lines in Helvetica, and its own title if given. */
export function tinyPdf(
	lines: string[],
	options: { title?: string } = {},
): Uint8Array {
	const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
	const content = [
		"BT /F1 12 Tf 72 720 Td 16 TL",
		...lines.map((line) => `(${esc(line)}) Tj T*`),
		"ET",
	].join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	if (options.title !== undefined) {
		objects.push(`<< /Title (${esc(options.title)}) >>`);
	}
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
	const info =
		options.title === undefined ? "" : ` /Info ${objects.length} 0 R`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${info} >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}

/** A store-only ZIP of these files. */
function zip(files: Record<string, string>): Uint8Array {
	const enc = new TextEncoder();
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const nameBytes = enc.encode(name);
		const data = enc.encode(text);
		const crc = crc32(data);
		const head = new DataView(new ArrayBuffer(30));
		head.setUint32(0, 0x04034b50, true);
		head.setUint16(4, 20, true);
		head.setUint32(14, crc, true);
		head.setUint32(18, data.length, true);
		head.setUint32(22, data.length, true);
		head.setUint16(26, nameBytes.length, true);
		local.push(new Uint8Array(head.buffer), nameBytes, data);
		const dir = new DataView(new ArrayBuffer(46));
		dir.setUint32(0, 0x02014b50, true);
		dir.setUint16(4, 20, true);
		dir.setUint16(6, 20, true);
		dir.setUint32(16, crc, true);
		dir.setUint32(20, data.length, true);
		dir.setUint32(24, data.length, true);
		dir.setUint16(28, nameBytes.length, true);
		dir.setUint32(42, offset, true);
		central.push(new Uint8Array(dir.buffer), nameBytes);
		offset += 30 + nameBytes.length + data.length;
	}
	const size = central.reduce((n, part) => n + part.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, Object.keys(files).length, true);
	end.setUint16(10, Object.keys(files).length, true);
	end.setUint32(12, size, true);
	end.setUint32(16, offset, true);
	const parts = [...local, ...central, new Uint8Array(end.buffer)];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

/** A Word file with a title paragraph and these paragraphs. */
export function tinyDocx(title: string, paragraphs: string[]): Uint8Array {
	const esc = (s: string) =>
		s.replace(
			/[<>&]/g,
			(c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string,
		);
	const para = (text: string, style?: string) =>
		`<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
	return zip({
		"[Content_Types].xml":
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
		"_rels/.rels":
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${para(title, "Title")}${paragraphs.map((p) => para(p)).join("")}</w:body></w:document>`,
	});
}
