import { PAGE_READER_ENV, type PageReaderSetting } from "@nightshift/flows";
import { now } from "@nightshift/time";
import type { AddressRules } from "../../web-access";
import { openReaderRoute } from "./adapters/in/reader-endpoint";
import { stepRoute } from "./adapters/in/step-route";
import { fsReadMarks } from "./adapters/out/fs-read-marks";
import { webReaderServices } from "./adapters/out/web-reader-services";
import { webSiteFacts } from "./adapters/out/web-site-facts";
import { checkReaderReady } from "./application/check-reader-ready";
import { chooseReader } from "./application/choose-reader";
import { lookAtLinks } from "./application/look-at-links";
import { openStepReader } from "./application/open-step-reader";
import type { ReaderSettings } from "./application/ports";
import { createLookMemo, type LinkLook } from "./domain/link-look";
import type { ReaderSecret } from "./domain/reader-choice";

/**
 * The wiring of knowledge/readers: the one place that builds its real adapters
 * and binds each use case to its ports.
 *
 * The page readers of this computer's projects (ADR 39), as one module:
 * the reader a project's setting names, built with its key; the step's
 * reader on the loopback listener, for a sync flow's Command step; the
 * marks that tell a page did not change; and the quick look at a link.
 */

/** What the knowledge gives knowledge/readers: the ports another part fills, and what the real adapters stand on. */
export type ReadersDeps = {
	/** Where this computer keeps its data: the marks are in its `knowledge/.reads/`. */
	dataDir: string;
	/** The project's reader setting, as its Space has it. */
	settings: ReaderSettings;
	/** Where a reader of this computer may connect now. */
	rules: () => AddressRules;
	/** A secret outside a run, for the quick look. */
	secret?: ReaderSecret;
	/** The quick look's clock. Default `now`. */
	clock?: () => number;
};

/** The page readers of this computer's projects, bound to their ports. */
export type PageReaders = {
	/**
	 * A Command step of the project starts: its reader on the loopback
	 * listener, in `NS_READER_URL` and `NS_READER_TOKEN`, until `close`. A key
	 * the reader needs comes from `secret`, the step's scopes
	 * (`openStepReader`).
	 */
	forStep(
		projectId: string,
		secret: ReaderSecret,
	): Promise<{ env: Record<string, string>; close(): Promise<void> }>;
	/** The quick look at each link, in their order, with the project's reader (`lookAtLinks`). */
	look(projectId: string, urls: readonly string[]): Promise<LinkLook[]>;
	/**
	 * The secret of the project's reader is saved where this computer finds
	 * it outside a run. Always true for Night Shift's own reader, which has
	 * no key (`checkReaderReady`).
	 */
	ready(projectId: string): Promise<boolean>;
	/** Chooses the page reader of the project, for every Device of its Space. Returns it (`chooseReader`). */
	choose(
		projectId: string,
		setting: PageReaderSetting,
	): Promise<PageReaderSetting>;
	/** Writes the marks that wait. */
	close(): Promise<void>;
};

export function wireReaders(deps: ReadersDeps): PageReaders {
	const services = webReaderServices({ rules: deps.rules });
	const marks = fsReadMarks(deps.dataDir);
	const secret = deps.secret ? { secret: deps.secret } : {};
	const look = lookAtLinks({
		settings: deps.settings,
		services,
		sites: webSiteFacts({ rules: deps.rules }),
		memo: createLookMemo(),
		...secret,
		now: deps.clock ?? now,
	});
	const open = openStepReader({ settings: deps.settings, services, marks });
	const ready = checkReaderReady({ settings: deps.settings, ...secret });
	const choose = chooseReader({ settings: deps.settings });
	return {
		async forStep(projectId, secret) {
			const reader = await open({ projectId, secret });
			const route = await openReaderRoute(stepRoute(reader));
			return {
				env: {
					[PAGE_READER_ENV.url]: route.url,
					[PAGE_READER_ENV.token]: route.token,
				},
				async close() {
					route.close();
					await reader.close();
				},
			};
		},
		look: (projectId, urls) => look({ projectId, urls }),
		ready: (projectId) => ready({ projectId }),
		choose: (projectId, setting) => choose({ projectId, setting }),
		close: () => marks.flush(),
	};
}
