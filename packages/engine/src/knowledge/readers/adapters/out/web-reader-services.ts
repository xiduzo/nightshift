import type { AddressRules } from "../../../../web-access";
import type { ReaderServices } from "../../application/ports";
import { firecrawlReader } from "./firecrawl-page-reader";
import { jinaReader } from "./jina-page-reader";
import { localReader } from "./local-page-reader";

/**
 * The page readers of this computer over the web: Night Shift's own, made
 * once, and a service's reader, made for each use with its address and key.
 * `rules`: where a reader of this computer may connect now.
 */
export function webReaderServices(deps: {
	rules: () => AddressRules;
}): ReaderServices {
	const local = localReader({ rules: deps.rules });
	return {
		local,
		look: local.look,
		service(kind, options) {
			const service = { ...options, rules: deps.rules };
			return kind === "jina" ? jinaReader(service) : firecrawlReader(service);
		},
	};
}
