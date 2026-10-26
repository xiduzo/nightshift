/**
 * The node inspector's three tabs: what the node does, what it gives later
 * nodes, and how it runs. Each InspectorSection names its tab; a section
 * outside a tabbed inspector (flow, edge, section) always shows.
 */
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import {
	createContext,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";

export type InspectorTab = "work" | "results" | "setup";

const TABS: { value: InspectorTab; label: string }[] = [
	{ value: "work", label: "Work" },
	{ value: "results", label: "Results" },
	{ value: "setup", label: "Setup" },
];

type TabsState = {
	active: InspectorTab;
	/** Counts a section on its tab while it is mounted. */
	register: (tab: InspectorTab) => () => void;
};

const TabsContext = createContext<TabsState | null>(null);

/**
 * Whether a section on `tab` shows now. It registers the section, so a tab
 * with no sections is left out of the list.
 */
export function useInspectorTab(tab: InspectorTab): boolean {
	const tabs = useContext(TabsContext);
	const register = tabs?.register;
	useLayoutEffect(() => register?.(tab), [register, tab]);
	return tabs === null || tabs.active === tab;
}

/** The tab list on top of the sections, and the sections below it. */
export function InspectorTabs({ children }: { children: React.ReactNode }) {
	const [active, setActive] = useState<InspectorTab>("work");
	const [counts, setCounts] = useState<Record<InspectorTab, number>>({
		work: 0,
		results: 0,
		setup: 0,
	});
	const register = useCallback((tab: InspectorTab) => {
		setCounts((current) => ({ ...current, [tab]: current[tab] + 1 }));
		return () =>
			setCounts((current) => ({ ...current, [tab]: current[tab] - 1 }));
	}, []);
	const tabs = TABS.filter((tab) => counts[tab.value] > 0);
	// A node without sections on the open tab shows its first tab.
	const shown =
		counts[active] > 0 ? active : (tabs[0]?.value ?? ("work" as const));
	const state = useMemo(() => ({ active: shown, register }), [shown, register]);

	return (
		<TabsContext.Provider value={state}>
			<Tabs
				value={shown}
				onValueChange={(value) => setActive(value as InspectorTab)}
			>
				{tabs.length > 1 ? (
					<TabsList className="mx-4 mb-3 w-auto">
						{tabs.map((tab) => (
							<TabsTrigger key={tab.value} value={tab.value}>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				) : null}
				{/* One panel: the sections hide themselves when not on the open tab. */}
				<TabsContent value={shown} className="border-t">
					{children}
				</TabsContent>
			</Tabs>
		</TabsContext.Provider>
	);
}
