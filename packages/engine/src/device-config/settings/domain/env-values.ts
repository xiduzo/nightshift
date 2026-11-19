/**
 * Readers of a setting's environment variable. Each gives undefined when
 * the variable does not make a valid value.
 */

export const int = (raw: string) => {
	const n = Number(raw.trim());
	return Number.isInteger(n) ? n : undefined;
};
export const text = (raw: string) =>
	raw.trim() === "" ? undefined : raw.trim();

export const onOff = (raw: string) => {
	const value = raw.trim().toLowerCase();
	if (["on", "true", "1"].includes(value)) return true;
	if (["off", "false", "0"].includes(value)) return false;
	return undefined;
};

/**
 * `OLLAMA_HOST` as an address, read as Ollama's CLI reads it: a scheme is
 * optional (http), and so is the port (11434 over http).
 */
export function ollamaHostAddress(raw: string): string | undefined {
	const value = raw.trim();
	if (value === "") return undefined;
	const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
	let url: URL;
	try {
		url = new URL(scheme ? value : `http://${value}`);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	if (
		url.port === "" &&
		url.protocol === "http:" &&
		!/:\d+(\/|$)/.test(value)
	) {
		url.port = "11434";
	}
	return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
}

export const list = (raw: string) => {
	const items = raw
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
};
