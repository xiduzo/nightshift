/**
 * PROTOTYPE (throwaway, branch prototype/sidebar-nav): which sidebar the
 * shell shows, and the floating bar that flips between them.
 *
 * Question: the sidebar is overcrowded. Which structure fixes it?
 * Four variants, switchable with `?nav=A|B|C|D`, the ← and → keys or the
 * bar. The choice stays in localStorage, so it survives clicking around.
 */
import { Button } from "@nightshift/ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

export const NAV_VARIANTS = [
	{ key: "A", name: "Today" },
	{ key: "B", name: "Everything in menus" },
	{ key: "C", name: "Drill into a project" },
	{ key: "D", name: "Two rails" },
] as const;
export type NavVariant = (typeof NAV_VARIANTS)[number]["key"];

const STORAGE_KEY = "prototype-nav";
const listeners = new Set<() => void>();
let current: NavVariant = "A";
let initialised = false;

const isVariant = (v: string | null): v is NavVariant =>
	NAV_VARIANTS.some((n) => n.key === v);

function init() {
	if (initialised || typeof window === "undefined") return;
	initialised = true;
	const fromUrl = new URLSearchParams(window.location.search).get("nav");
	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (isVariant(fromUrl)) current = fromUrl;
	else if (isVariant(stored)) current = stored;
}

function setVariant(next: NavVariant) {
	current = next;
	window.localStorage.setItem(STORAGE_KEY, next);
	const url = new URL(window.location.href);
	url.searchParams.set("nav", next);
	window.history.replaceState(window.history.state, "", url);
	for (const l of listeners) l();
}

export function useNavVariant(): NavVariant {
	return useSyncExternalStore(
		(l) => {
			init();
			listeners.add(l);
			// The first client render used the server value: catch up.
			queueMicrotask(l);
			return () => listeners.delete(l);
		},
		() => {
			init();
			return current;
		},
		() => "A",
	);
}

/** The floating bar. Not part of any design: it only flips variants. */
export function PrototypeNavSwitcher() {
	const variant = useNavVariant();
	const index = NAV_VARIANTS.findIndex((v) => v.key === variant);
	const step = (by: number) =>
		setVariant(
			NAV_VARIANTS[(index + by + NAV_VARIANTS.length) % NAV_VARIANTS.length]
				.key,
		);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (
				t?.closest(
					"input, textarea, select, [contenteditable=''], [contenteditable='true']",
				)
			)
				return;
			if (e.key === "ArrowLeft") step(-1);
			if (e.key === "ArrowRight") step(1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	if (import.meta.env.PROD) return null;
	return (
		<div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-fuchsia-500 bg-fuchsia-950 p-1 text-fuchsia-50 shadow-2xl">
			<Button
				size="icon-sm"
				variant="ghost"
				className="rounded-full hover:bg-fuchsia-800"
				onClick={() => step(-1)}
				aria-label="Previous variant"
			>
				<ChevronLeftIcon />
			</Button>
			<span className="min-w-56 text-center font-mono text-xs">
				Nav {variant} · {NAV_VARIANTS[index].name}
			</span>
			<Button
				size="icon-sm"
				variant="ghost"
				className="rounded-full hover:bg-fuchsia-800"
				onClick={() => step(1)}
				aria-label="Next variant"
			>
				<ChevronRightIcon />
			</Button>
		</div>
	);
}
