/**
 * The node inspector's three tabs: what the node does, what it gives later
 * nodes, and how it runs. Each InspectorSection names its tab; a section
 * outside a tabbed inspector (flow, edge, section) always shows. A tab that
 * is not open shows how many errors its sections hold.
 */
import { Badge } from "@nightshift/ui/components/badge";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { CircleAlertIcon } from "lucide-react";
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
	/** Adds a section's errors to its tab while they show. */
	addErrors: (tab: InspectorTab, errors: number) => () => void;
};

type Counts = Record<InspectorTab, number>;

const NONE: Counts = { work: 0, results: 0, setup: 0 };

function add(counts: Counts, tab: InspectorTab, by: number): Counts {
	return { ...counts, [tab]: counts[tab] + by };
}

const TabsContext = createContext<TabsState | null>(null);

/**
 * Whether a section on `tab` shows now. It registers the section, so a tab
 * with no sections is left out of the list, and its `errors` count on the tab.
 */
export function useInspectorTab(tab: InspectorTab, errors = 0): boolean {
	const tabs = useContext(TabsContext);
	const register = tabs?.register;
	const addErrors = tabs?.addErrors;
	useLayoutEffect(() => register?.(tab), [register, tab]);
	useLayoutEffect(
		() => (errors > 0 ? addErrors?.(tab, errors) : undefined),
		[addErrors, tab, errors],
	);
	return tabs === null || tabs.active === tab;
}

/** The red count of errors on a folded section or a tab that is not open. */
export function ErrorCount({ count }: { count: number }) {
	if (count === 0) return null;
	return (
		<Badge variant="destructive" className="tabular-nums">
			<CircleAlertIcon aria-hidden="true" />
			{count}
			<span className="sr-only">{count === 1 ? " error" : " errors"}</span>
		</Badge>
	);
}

/** The tab list on top of the sections, and the sections below it. */
export function InspectorTabs({ children }: { children: React.ReactNode }) {
	const [active, setActive] = useState<InspectorTab>("work");
	const [counts, setCounts] = useState(NONE);
	const [errors, setErrors] = useState(NONE);
	const register = useCallback((tab: InspectorTab) => {
		setCounts((current) => add(current, tab, 1));
		return () => setCounts((current) => add(current, tab, -1));
	}, []);
	const addErrors = useCallback((tab: InspectorTab, by: number) => {
		setErrors((current) => add(current, tab, by));
		return () => setErrors((current) => add(current, tab, -by));
	}, []);
	const tabs = TABS.filter((tab) => counts[tab.value] > 0);
	// A node without sections on the open tab shows its first tab.
	const shown =
		counts[active] > 0 ? active : (tabs[0]?.value ?? ("work" as const));
	const state = useMemo(
		() => ({ active: shown, register, addErrors }),
		[shown, register, addErrors],
	);

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
								{tab.value === shown ? null : (
									<ErrorCount count={errors[tab.value]} />
								)}
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
