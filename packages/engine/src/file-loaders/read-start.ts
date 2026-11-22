import { open } from "node:fs/promises";

/** The first `bytes` of a file as text, and its size. Null when it is no file. */
export async function readStart(
	abs: string,
	bytes: number,
): Promise<{ text: string; size: number } | null> {
	const handle = await open(abs, "r").catch(() => null);
	if (!handle) return null;
	try {
		const info = await handle.stat();
		if (!info.isFile()) return null;
		const length = Math.min(info.size, bytes);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, 0);
		return {
			text: buffer.subarray(0, bytesRead).toString("utf8"),
			size: info.size,
		};
	} finally {
		await handle.close();
	}
}
