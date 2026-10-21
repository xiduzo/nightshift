import { useSyncExternalStore } from "react";

import type { InFrontPlace, PushData } from "./push-data";

/** A push that came while the app was in front, shown as a banner in the app. */
export type Banner = { title: string; data: PushData; at: number };

let banner: Banner | null = null;
let place: InFrontPlace = { pathname: "/" };
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

/** The screen in front. `InFrontBanner` keeps it up to date. */
export function inFrontPlace(): InFrontPlace {
	return place;
}

export function setInFrontPlace(next: InFrontPlace): void {
	place = next;
}

/** Shows a banner in the app. A newer push replaces the one shown. */
export function showBanner(next: Omit<Banner, "at">): void {
	banner = { ...next, at: Date.now() };
	emit();
}

/** Hides the banner, or only the given one when a newer one replaced it. */
export function hideBanner(which?: Banner): void {
	if (which && banner !== which) return;
	banner = null;
	emit();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useBanner(): Banner | null {
	return useSyncExternalStore(subscribe, () => banner);
}
