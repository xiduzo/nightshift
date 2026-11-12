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
	/**
	 * The CLI ends a session at its turn limit itself (Claude Code's
	 * `--max-turns`). Unset: the engine counts the turns.
	 */
	limitsTurns?: true;
	/**
	 * How Night Shift installs the CLI and signs it in on this computer,
	 * after the person confirms (ADR 25). Unset: the person installs it.
	 */
	setup?: HarnessSetup;
};

/**
 * The guided setup of one harness's CLI: the vendor's own installer and the
 * CLI's own sign-in. Fixed data only: nothing of a request goes into what
 * runs (`@nightshift/engine/agent-setup` runs it).
 */
export type HarnessSetup = {
	/** Who publishes the CLI and its installer, for the person: "Anthropic". */
	vendor: string;
	/** The vendor's install script: a fixed https address, no shell characters. */
	installScript: `https://${string}`;
	/** The shell that runs the script, as the vendor documents it. */
	installShell: "bash" | "sh";
	/** Variables the installer gets on top of this computer's: none waits for an answer. */
	installEnv: Readonly<Record<string, string>>;
	/** The folder the installer puts the CLI in, relative to the home folder. */
	binDir: string;
	/** The CLI's own sign-in command, after the program (`auth login`). */
	signIn: readonly string[];
	/**
	 * The hosts a sign-in address may point at: the vendor's own, and their
	 * subdomains. Any other address in the CLI's output is not shown.
	 */
	signInHosts: readonly string[];
	/**
	 * How the sign-in talks to the CLI: plain pipes, or a terminal for a CLI
	 * that refuses to sign in without one.
	 */
	signInIo: "pipes" | "terminal";
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
