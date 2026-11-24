/**
 * A file that a run wrote, served inline, so an image or a video shows in
 * the page, with `?download` as an attachment. A `Range` request gets that
 * part only: Safari plays a video only through ranges.
 *
 * The file is whatever the run made, so it never runs as a page of this
 * origin: a sandbox without scripts, and no content sniffing.
 */
export function servedFile(
	request: Request,
	file: Blob,
	about: { name: string; mediaType: string; cache: string },
): Response {
	const download = new URL(request.url).searchParams.has("download");
	const headers = new Headers({
		"Content-Type": about.mediaType || "application/octet-stream",
		"Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(about.name)}`,
		"Content-Security-Policy": "sandbox",
		"X-Content-Type-Options": "nosniff",
		"Accept-Ranges": "bytes",
		"Cache-Control": about.cache,
	});
	const size = file.size;
	const range = parseRange(request.headers.get("range"), size);
	if (range === "invalid") {
		headers.set("Content-Range", `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}
	if (range) {
		headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
		headers.set("Content-Length", String(range.end - range.start + 1));
		return new Response(file.slice(range.start, range.end + 1), {
			status: 206,
			headers,
		});
	}
	headers.set("Content-Length", String(size));
	return new Response(file, { headers });
}

/**
 * One `bytes=` range of a file of `size` bytes, both ends inclusive. Null
 * for no header or one this does not serve (several ranges): the whole file.
 */
export function parseRange(
	header: string | null,
	size: number,
): { start: number; end: number } | "invalid" | null {
	const match = header?.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;
	const [, from = "", to = ""] = match;
	if (from === "" && to === "") return "invalid";
	const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
	const end =
		from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
	if (start > end || start >= size) return "invalid";
	return { start, end };
}
