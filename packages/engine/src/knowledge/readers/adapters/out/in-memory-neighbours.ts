import type { PageReaderSetting } from "@nightshift/flows";
import { parseInstant } from "@nightshift/time";
import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import type { ReaderSettings } from "../../application/ports";
import { createLookMemo } from "../../domain/link-look";
import { inMemoryReadMarks } from "./in-memory-read-marks";
import { inMemoryReaderServices } from "./in-memory-reader-services";
import { inMemorySiteFacts } from "./in-memory-site-facts";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryReadersPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** The reader settings of a test's projects: Night Shift's own reader until a test sets one. */
export function inMemoryReaderSettings() {
	const settings = new Map<string, PageReaderSetting>();
	const twin = {
		/** Every choice, in order. */
		chosen: [] as { projectId: string; setting: PageReaderSetting }[],
		async setting(projectId: string): Promise<PageReaderSetting> {
			return settings.get(projectId) ?? { kind: "nightshift" };
		},
		async choose(projectId: string, setting: PageReaderSetting) {
			twin.chosen.push({ projectId, setting });
			settings.set(projectId, setting);
			return twin.setting(projectId);
		},
	};
	return twin satisfies ReaderSettings;
}

/** A clock a test sets. */
export function testClock(at = parseInstant("2026-11-20T12:00:00Z")) {
	const clock = {
		at,
		now: () => clock.at,
	};
	return clock;
}

/** Every port of knowledge/readers in memory at once: where each use-case test starts. */
export function inMemoryReadersPorts() {
	const clock = testClock();
	return {
		access: inMemoryAccess(),
		settings: inMemoryReaderSettings(),
		services: inMemoryReaderServices(),
		sites: inMemorySiteFacts(),
		marks: inMemoryReadMarks(),
		memo: createLookMemo(),
		clock,
		now: clock.now,
	};
}
