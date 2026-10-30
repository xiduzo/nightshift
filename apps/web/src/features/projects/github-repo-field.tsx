import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { FolderGitIcon, LockIcon } from "lucide-react";
import { useState } from "react";
import { projectQueries } from "./queries";

type GitHubAccess = "missing" | "signed-out" | "signed-in";

/** How the description under the field guides the person, by the GitHub sign-in of this computer. */
const HINT: Record<GitHubAccess, string> = {
	"signed-in": "Choose one of your repositories, or enter one.",
	"signed-out":
		"Enter a repository or its GitHub link. For a private repository, run gh auth login on this computer.",
	missing:
		"Enter a public repository or its GitHub link. For a private repository, install the GitHub CLI and run gh auth login.",
};

/**
 * The GitHub repository to add: a searchable list of the person's own
 * repositories when GitHub is signed in on this computer, else a text field.
 */
export function GitHubRepoField({
	id,
	access,
	value,
	onChange,
	disabled,
	error,
}: {
	id: string;
	access: GitHubAccess;
	value: string;
	onChange: (repo: string) => void;
	disabled?: boolean;
	error?: string | null;
}) {
	const signedIn = access === "signed-in";
	const repos = useQuery({
		...projectQueries.gitHubRepos(),
		enabled: signedIn,
		staleTime: 5 * 60_000,
		meta: { quietErrors: true },
	});
	const list = repos.data ?? [];
	const names = list.map((repo) => repo.name);
	// The whole list on open; filter only once the person types.
	const [typed, setTyped] = useState(false);
	const query = value.trim().toLowerCase();
	const shown = typed
		? names.filter((name) => name.toLowerCase().includes(query))
		: names;
	const privateRepos = new Set(
		list.filter((repo) => repo.private).map((repo) => repo.name),
	);
	const descriptions = new Map(
		list.map((repo) => [repo.name, repo.description]),
	);

	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>Repository</FieldLabel>
			{signedIn ? (
				<Combobox
					items={names}
					filteredItems={shown}
					filter={null}
					value={names.includes(value) ? value : null}
					inputValue={value}
					onInputValueChange={(next) => {
						setTyped(true);
						onChange(next);
					}}
					onValueChange={(next: string | null) => {
						if (next) onChange(next);
					}}
					onOpenChange={(open) => {
						if (open) setTyped(false);
					}}
					disabled={disabled}
				>
					<ComboboxInput
						id={id}
						className="w-full"
						placeholder="acme/app"
						autoComplete="off"
						spellCheck={false}
						autoFocus
						aria-invalid={error ? true : undefined}
					/>
					<ComboboxContent>
						<ComboboxEmpty>
							{repos.isFetching
								? "Loading your repositories…"
								: "Not in your list. You can still add it."}
						</ComboboxEmpty>
						<ComboboxList>
							{(name: string) => (
								<ComboboxItem key={name} value={name}>
									<span className="flex min-w-0 flex-col">
										<span className="flex items-center gap-1.5">
											{name}
											{privateRepos.has(name) ? (
												<LockIcon
													className="size-3 text-muted-foreground"
													aria-label="Private"
												/>
											) : null}
										</span>
										{descriptions.get(name) ? (
											<span className="truncate text-muted-foreground text-xs">
												{descriptions.get(name)}
											</span>
										) : null}
									</span>
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			) : (
				<Input
					id={id}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder="acme/app"
					autoComplete="off"
					spellCheck={false}
					autoFocus
					disabled={disabled}
					aria-invalid={error ? true : undefined}
				/>
			)}
			<FieldDescription>{HINT[access]}</FieldDescription>
			{repos.error ? (
				<FieldDescription>{repos.error.message}</FieldDescription>
			) : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}

/** The copy of a GitHub repository on this computer: on its way, or there. */
export function GitHubCopyStatus({
	repo,
	copying,
	reused,
}: {
	repo: string;
	copying: boolean;
	reused: boolean;
}) {
	return (
		<Item variant="outline" size="sm" aria-live="polite">
			<ItemMedia variant="icon">
				{copying ? <Spinner /> : <FolderGitIcon />}
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>{copying ? `Copying ${repo}…` : repo}</ItemTitle>
				<ItemDescription>
					{copying
						? "A large repository can take a few minutes."
						: reused
							? "Already on this computer."
							: "Copied to this computer."}
				</ItemDescription>
			</ItemContent>
		</Item>
	);
}
