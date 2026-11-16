import {
	type HowMuch,
	type HowOften,
	type LinkLook,
	type LinkPlan,
	linkPlan,
	linksIn,
} from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Toggle } from "@nightshift/ui/components/toggle";
import { useQueries } from "@tanstack/react-query";
import {
	BotIcon,
	FileIcon,
	FileTextIcon,
	FolderTreeIcon,
	LockIcon,
	RssIcon,
	TriangleAlertIcon,
	VideoIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { knowledgeQueries } from "./queries";

/** How long the typing rests before Night Shift looks at the links, in ms. */
const TYPING_PAUSE = 600;

/** The most links one Tell looks at: the quick look takes 20. */
const MOST_LINKS = 20;

/** What the person chose for one link. Unset: the default of its plan. */
type LinkChoice = { much?: HowMuch; often?: HowOften; agent?: boolean };

/** One link of the box, with its look once it is there. */
export type ToldLink = {
	url: string;
	/** Undefined while Night Shift looks. Null: the look did not work. */
	look: LinkLook | null | undefined;
	plan: LinkPlan | null;
	much: HowMuch | null;
	often: HowOften;
	/** For a link Night Shift cannot read: the person lets an agent fetch it. */
	agent: boolean;
};

/**
 * The links of a told text, once the typing rests, each with Night Shift's
 * quick look and what the person chose for it. A link the person leaves out
 * stays out until the box is cleared.
 */
export function useToldLinks(
	projectId: string,
	text: string,
	options: { enabled: boolean; schedules: boolean },
) {
	const [resting, setResting] = useState(text);
	const [dropped, setDropped] = useState<string[]>([]);
	const [choices, setChoices] = useState<Record<string, LinkChoice>>({});
	useEffect(() => {
		const timer = setTimeout(() => setResting(text), TYPING_PAUSE);
		return () => clearTimeout(timer);
	}, [text]);

	const urls = options.enabled
		? linksIn(resting)
				.filter((url) => !dropped.includes(url))
				.slice(0, MOST_LINKS)
		: [];
	const looks = useQueries({
		queries: urls.map((url) => ({
			...knowledgeQueries.look(projectId, url),
			meta: { quietErrors: true },
		})),
	});

	const links: ToldLink[] = urls.map((url, index) => {
		const query = looks[index];
		const look = query?.data?.[0] ?? (query?.isError ? null : undefined);
		const plan = look ? linkPlan(look) : null;
		const chosen = choices[url] ?? {};
		const often =
			!options.schedules || plan === null || plan.action === "none"
				? "once"
				: (chosen.often ?? plan.often);
		return {
			url,
			look,
			plan,
			much:
				plan?.action === "read" && plan.much
					? (chosen.much ?? plan.much.initial)
					: null,
			often,
			agent: chosen.agent ?? false,
		};
	});

	return {
		links,
		/** Night Shift still looks at a link, or the typing has not rested. */
		looking:
			links.some((link) => link.look === undefined) ||
			(options.enabled &&
				linksIn(text).join(" ") !== linksIn(resting).join(" ")),
		choose: (url: string, choice: LinkChoice) =>
			setChoices((now) => ({ ...now, [url]: { ...now[url], ...choice } })),
		drop: (url: string) => setDropped((now) => [...now, url]),
		reset: () => {
			setDropped([]);
			setChoices({});
		},
	};
}

export type ToldLinks = ReturnType<typeof useToldLinks>;

/** An address as a person reads it: without the scheme, `www.` and the last slash. */
export function shortLink(url: string): string {
	return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

const OFTEN: { value: HowOften; label: string }[] = [
	{ value: "day", label: "Every day" },
	{ value: "week", label: "Every week" },
	{ value: "month", label: "Every month" },
	{ value: "once", label: "Only now" },
];

/** How often Night Shift checks a told source for changes. */
export function OftenSelect({
	value,
	onChange,
	schedules,
}: {
	value: HowOften;
	onChange: (often: HowOften) => void;
	/** The person may add a schedule: this computer's owner. */
	schedules: boolean;
}) {
	return (
		<NativeSelect
			size="sm"
			aria-label="How often to check for changes"
			title={
				schedules
					? undefined
					: "Only the owner of this computer can choose how often."
			}
			disabled={!schedules}
			value={schedules ? value : "once"}
			onChange={(event) => onChange(event.target.value as HowOften)}
		>
			{OFTEN.map((option) => (
				<NativeSelectOption key={option.value} value={option.value}>
					{option.label}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

function muchLabel(much: HowMuch, pages: number, folderPages: number): string {
	if (much === "page") return "Just this page";
	if (much === "all" && pages === folderPages) return `All ${pages} pages`;
	return `First ${pages} pages`;
}

const FILE_TYPE = {
	pdf: "A PDF file",
	word: "A Word file",
	text: "A text file",
};

/** What a look says of a link, in one line. */
function lookLine(look: LinkLook): { icon: ReactNode; detail: string } {
	switch (look.kind) {
		case "page":
		case "section":
			return look.section && look.section.pages > 1
				? {
						icon:
							look.kind === "section" || look.section.starts ? (
								<FolderTreeIcon />
							) : (
								<FileTextIcon />
							),
						detail: `${look.section.pages} pages in ${shortLink(look.section.folder)}`,
					}
				: { icon: <FileTextIcon />, detail: "One page" };
		case "feed":
			return {
				icon: <RssIcon />,
				detail: look.items?.perWeek
					? `A feed, about ${Math.round(look.items.perWeek)} new a week`
					: "A feed",
			};
		case "file":
			return {
				icon: <FileIcon />,
				detail: look.fileType ? FILE_TYPE[look.fileType] : "A file",
			};
		case "signin":
			return { icon: <LockIcon />, detail: "Asks you to sign in" };
		case "needs-browser":
			return { icon: <BotIcon />, detail: "Shows its text only in a browser" };
		case "blocked":
			return { icon: <LockIcon />, detail: "The site keeps readers out" };
		case "failed":
			return {
				icon: <TriangleAlertIcon />,
				detail: "Night Shift cannot read it",
			};
		case "media":
			return { icon: <VideoIcon />, detail: "Video or audio" };
		case "gone":
			return {
				icon: <TriangleAlertIcon className="text-destructive" />,
				detail: "Does not load. Check the address.",
			};
	}
}

/**
 * The links of the box, one row each: what Night Shift found, how much of
 * it to read and how often to check it for changes. A link Night Shift
 * cannot read offers an agent instead.
 */
export function ToldLinkRows({
	told,
	schedules,
}: {
	told: ToldLinks;
	/** The person may add a schedule: this computer's owner. */
	schedules: boolean;
}) {
	if (told.links.length === 0) return null;
	return (
		<ItemGroup className="w-full gap-0 border-t px-1 py-1">
			{told.links.map((link) => (
				<LinkRow
					key={link.url}
					link={link}
					schedules={schedules}
					onChoose={(choice) => told.choose(link.url, choice)}
					onDrop={() => told.drop(link.url)}
				/>
			))}
		</ItemGroup>
	);
}

function LinkRow({
	link,
	schedules,
	onChoose,
	onDrop,
}: {
	link: ToldLink;
	schedules: boolean;
	onChoose: (choice: LinkChoice) => void;
	onDrop: () => void;
}) {
	const { look, plan } = link;
	const drop = (
		<Button
			size="icon-xs"
			variant="ghost"
			aria-label={`Leave ${shortLink(link.url)} out`}
			onClick={onDrop}
		>
			<XIcon />
		</Button>
	);
	if (look === undefined || look === null || plan === null) {
		return (
			<Item size="xs" className="flex-nowrap">
				<ItemMedia variant="icon">
					{look === undefined ? <Spinner /> : <TriangleAlertIcon />}
				</ItemMedia>
				<ItemContent className="min-w-0">
					<ItemTitle className="w-full">
						<span className="truncate">{shortLink(link.url)}</span>
					</ItemTitle>
					<ItemDescription>
						{look === undefined
							? "Night Shift looks at it…"
							: "Night Shift could not look at it. Try again later."}
					</ItemDescription>
				</ItemContent>
				<ItemActions>{drop}</ItemActions>
			</Item>
		);
	}
	const line = lookLine(look);
	return (
		<Item size="xs" className="flex-wrap sm:flex-nowrap">
			<ItemMedia variant="icon">{line.icon}</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full">
					<span className="truncate">{look.title ?? shortLink(link.url)}</span>
				</ItemTitle>
				<ItemDescription className="truncate">{line.detail}</ItemDescription>
			</ItemContent>
			<ItemActions className="flex-wrap">
				{plan.action === "read" ? (
					<>
						{plan.much ? (
							<NativeSelect
								size="sm"
								aria-label="How much to read"
								value={link.much ?? plan.much.initial}
								onChange={(event) =>
									onChoose({ much: event.target.value as HowMuch })
								}
							>
								{plan.much.choices.map((choice) => (
									<NativeSelectOption key={choice.much} value={choice.much}>
										{muchLabel(
											choice.much,
											choice.pages,
											look.section?.pages ?? 0,
										)}
									</NativeSelectOption>
								))}
							</NativeSelect>
						) : null}
						<OftenSelect
							value={link.often}
							schedules={schedules}
							onChange={(often) => onChoose({ often })}
						/>
					</>
				) : plan.action === "agent" ? (
					<>
						<Toggle
							size="sm"
							variant="outline"
							pressed={link.agent}
							onPressedChange={(agent) => onChoose({ agent })}
						>
							<BotIcon data-icon="inline-start" />
							{plan.transcript ? "Get the transcript" : "Let an agent fetch it"}
						</Toggle>
						{link.agent ? (
							<OftenSelect
								value={link.often}
								schedules={schedules}
								onChange={(often) => onChoose({ often })}
							/>
						) : null}
					</>
				) : null}
				{drop}
			</ItemActions>
		</Item>
	);
}
