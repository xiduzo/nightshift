import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { drizzleTargetStore } from "./adapters/out/drizzle-target-store";
import { findTargets } from "./application/find-targets";
import { forgetTarget } from "./application/forget-target";
import { listScreens } from "./application/list-screens";
import { listTargets } from "./application/list-targets";
import type { Sessions } from "./application/ports";
import { registerScreen } from "./application/register-screen";
import { registerTarget } from "./application/register-target";
import { removeScreen } from "./application/remove-screen";

/**
 * The wiring of targets: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the package gives targets: the sessions auth keeps, the clock, and what the real adapters stand on. */
export type TargetsDeps = {
	db: Database;
	sessions: Sessions;
	clock: () => number;
};

/** The use cases of targets, bound to their ports. */
export type Targets = {
	/** The screens of the Person who asks, as they see them. */
	list: ReturnType<typeof listScreens>;
	/** Registers a screen of a Person, for Night Shift: this computer's desktop app. */
	registerTarget: ReturnType<typeof registerTarget>;
	/** Registers a browser or a phone of the Person who asks. */
	register: ReturnType<typeof registerScreen>;
	/** Removes a screen of the Person who asks, and signs a phone out. */
	remove: ReturnType<typeof removeScreen>;
	/** The Person's push targets, to push to. */
	listTargets: ReturnType<typeof listTargets>;
	/** These push targets, by id. */
	findTargets: ReturnType<typeof findTargets>;
	/** Forgets a target its push service no longer knows. */
	forgetTarget: ReturnType<typeof forgetTarget>;
};

export function wireTargets(deps: TargetsDeps): Targets {
	const ports = {
		sessions: deps.sessions,
		clock: deps.clock,
		newId: () => randomUUID(),
		targetStore: drizzleTargetStore(deps.db),
	};
	const listed = listTargets(ports);
	const registered = registerTarget(ports);
	return {
		list: listScreens({ listTargets: listed }),
		registerTarget: registered,
		register: registerScreen({ registerTarget: registered }),
		remove: removeScreen(ports),
		listTargets: listed,
		findTargets: findTargets(ports),
		forgetTarget: forgetTarget(ports),
	};
}
