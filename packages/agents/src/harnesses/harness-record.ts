/**
 * The shape of one record in the harness registry. Each harness folder
 * gives its record in two parts:
 * - `facts.ts`: pure data (`HarnessFacts`). It imports no adapter code, so
 *   the browser-safe `./harness-facts` entry and the engine read it
 *   without loading a harness.
 * - `record.ts`: the facts, plus the models of its TanStack adapter and its
 *   install check (`HarnessAdapter`). The models are a copy, typed against
 *   the adapter's list, so the registry loads no adapter. `registry.ts`
 *   collects them.
 */
import type { HarnessCatalogEntry } from "@nightshift/flows";

import type { CliCheck } from "../doctor";

/**
 * What Night Shift knows about one harness without its adapter: what a
 * person sees of it (`HARNESS_CATALOG` in `@nightshift/flows`, browser-safe),
 * and how Night Shift runs it.
 */
export type HarnessFacts = HarnessCatalogEntry & {
	/** The `@tanstack/ai-*` package. */
	pkg: string;
	/** The CLI it runs, as found on the PATH. */
	bin: string;
	/** The CLI's own command that lists the models it can reach, if it has one. */
	listing: readonly string[] | null;
	/**
	 * The CLI's own command that reopens a session, given its id already
	 * quoted for the shell. Null: the CLI has none.
	 */
	takeOver: ((quotedSessionId: string) => string) | null;
	/**
	 * Where the harness looks for skills of the user, relative to the home
	 * folder. `.agents/skills` is the shared folder that most of them read.
	 */
	skillDirs: readonly string[];
};

/** A harness adapter: the TanStack AI package that drives one coding-agent CLI. */
export type HarnessAdapter = HarnessFacts & {
	/** The models the adapter knows, for autocomplete: any other id works too. */
	models: readonly string[];
	/**
	 * Reads the listing's output. Default: each stdout line that is one
	 * `provider/model`.
	 */
	parseListing?: (out: { stdout: string; stderr: string }) => string[];
	/**
	 * The version, and the login where the CLI can tell. Default: the
	 * version only (`baseCheck`).
	 */
	check?: (bin: string) => Promise<CliCheck>;
};
