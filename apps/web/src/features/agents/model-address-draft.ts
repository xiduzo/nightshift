/** The address fields of a Model Profile as the form holds them, and the rules they follow. */
import type { ModelAddress } from "@nightshift/flows";
import {
	type KeyValueRow,
	recordFrom,
	rowsFrom,
} from "./connections/key-value-rows";

/** The address fields as the form holds them. Empty base URL: no address. */
export type AddressDraft = {
	baseUrl: string;
	/** The name of the secret that holds the API key. */
	apiKey: string;
	headers: KeyValueRow[];
};

export function addressDraftFrom(address: ModelAddress | undefined) {
	return {
		baseUrl: address?.baseUrl ?? "",
		apiKey: address?.apiKey ?? "",
		headers: rowsFrom(address?.headers),
	};
}

/** The address to save, or undefined for none. */
export function addressFrom(draft: AddressDraft): ModelAddress | undefined {
	const baseUrl = draft.baseUrl.trim();
	if (baseUrl === "") return undefined;
	const headers = recordFrom(draft.headers);
	return {
		baseUrl,
		...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
	};
}

export function sameAddress(a: AddressDraft, b: AddressDraft): boolean {
	return JSON.stringify(addressFrom(a)) === JSON.stringify(addressFrom(b));
}

const SECRET = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function isServerUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.search === "" &&
			url.hash === ""
		);
	} catch {
		return false;
	}
}

/** What is wrong with the address fields, by field. Empty when they can be saved. */
export function addressProblems(
	draft: AddressDraft,
	required: boolean,
): { baseUrl?: string; apiKey?: string } {
	const baseUrl = draft.baseUrl.trim();
	const apiKey = draft.apiKey.trim();
	return {
		...(baseUrl === ""
			? required
				? { baseUrl: "Add the address of its server." }
				: {}
			: isServerUrl(baseUrl)
				? {}
				: {
						baseUrl:
							"Use an http:// or https:// address, such as http://127.0.0.1:8080.",
					}),
		...(apiKey !== "" && !SECRET.test(apiKey)
			? {
					apiKey:
						"Use the name of a secret: letters, digits and _, starting with a letter or _.",
				}
			: {}),
	};
}
