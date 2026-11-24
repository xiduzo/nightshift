import type { Database } from "@nightshift/db";
import type { startDevices } from "@nightshift/devices";
import type { SyncedDocuments } from "@nightshift/engine";
import { deliveryMoves } from "@nightshift/notifications";
import {
	documentAudience,
	sendsPushesFor,
	wireNotifications,
} from "./notifications";

type NotificationsWiring = Parameters<typeof wireNotifications>[0];
type DevicesEngine = Awaited<ReturnType<typeof startDevices>>["engine"];

/**
 * A Space move takes the notifier's log of the moved runs along. Their new
 * Space's sender notifies for them from then on.
 */
export function notificationMoves(
	db: Database,
	settings: NotificationsWiring["settings"],
	owner: NotificationsWiring["owner"],
) {
	return deliveryMoves(db, sendsPushesFor(db, settings, owner));
}

/**
 * The notifications block of the daemon's composition (`daemon.ts`): the
 * notifier of this daemon, and what tells the open screens of a run, a
 * project, a document and the learnings. The lanes of `notifications`
 * edit this file, not `daemon.ts`.
 */
export async function wireDaemonNotifications(
	deps: NotificationsWiring & {
		engine: NotificationsWiring["engine"] & Pick<DevicesEngine, "exchange">;
		documents: Pick<SyncedDocuments, "documentOf" | "watchStored">;
	},
) {
	const { engine, documents, owner } = deps;
	const notifications = await wireNotifications({
		db: deps.db,
		auth: deps.auth,
		env: deps.env,
		engine,
		settings: deps.settings,
		device: deps.device,
		owner,
		desktop: deps.desktop,
		slots: deps.slots,
	});
	// An action that travels to another Device as a command logs nothing
	// here until that Device applies it: the open screens hear of it now,
	// so an answered Gate leaves every screen at once.
	engine.exchange.commands.onChanged(({ spaceId, runId }) => {
		notifications.runChanged(spaceId, runId).catch((error: unknown) => {
			console.error("Could not tell the open screens of a run:", error);
		});
	});
	const projectsChanged = (spaceId: string) => {
		notifications.projectsChanged(spaceId).catch((error: unknown) => {
			console.error("Could not tell the open screens of new projects:", error);
		});
	};
	// The same for an action that waits on a Host for another Device: this
	// computer's own answer, or one from the phone.
	engine.exchange.pendingOnHosts.onChanged(({ spaceId, runId }) => {
		notifications.runChanged(spaceId, runId).catch((error: unknown) => {
			console.error("Could not tell the open screens of a run:", error);
		});
	});
	const tellDocument = (name: string) => {
		documentAudience(name, {
			documentOf: (of) => documents.documentOf(of),
			personId: owner.userId,
		})
			.then(
				(audience) =>
					audience && notifications.documentChanged({ name, ...audience }),
			)
			.catch((error: unknown) => {
				console.error("Could not tell the open screens of a document:", error);
			});
	};
	// A reload binds the kept documents to this daemon's notifications.
	documents.watchStored((document) => tellDocument(document.name));
	return {
		notifications,
		projectsChanged,
		tellDocument,
		learningsChanged: notifications.learningsChanged,
	};
}
