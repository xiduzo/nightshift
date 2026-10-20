/**
 * The shape of one record in the harness registry. Each harness folder
 * gives its record in two parts:
 * - `facts.ts`: pure data (`HarnessFacts`). It imports no adapter code, so
 *   the browser-safe `./harness-facts` entry and the engine read it
 *   without loading a harness.
 * - `record.ts`: the facts, plus the models of its TanStack adapter and its
 *   install check (`HarnessAdapter`). `registry.ts` collects them.
 */
import type { CliCheck } from "../doctor";
import type { HarnessName } from "../port";

/** What Night Shift knows about one harness without its adapter. */
export type HarnessFacts = {
	name: HarnessName;
	/** The display name, for example "Claude Code". */
	label: string;
	/** Two letters for its tile. */
	initials: string;
	/** The `@tanstack/ai-*` package. */
	pkg: string;
	/** The CLI it runs, as found on the PATH. */
	bin: string;
	/** A new node, or a switch to this harness, starts with this model. */
	defaultModel: string;
	/** The CLI's own command that lists the models it can reach, if it has one. */
	listing: readonly string[] | null;
	/** One line under the picker: what this harness needs. */
	note: string;
	/** Where prompts and code go. */
	offMachine: string;
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
