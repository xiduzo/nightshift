import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
} from "@nightshift/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@nightshift/ui/components/field";
import { useId, useState } from "react";
import {
	type HarnessName,
	ModelCombobox,
	useHarnessModels,
} from "@/features/agents";

/** The models of one harness, the one in use checked, and a way to name another. */
export function HarnessModels({
	harness,
	current,
	onPick,
	onOther,
}: {
	harness: HarnessName;
	/** The model in use, when this harness answers. */
	current: string | null;
	onPick: (model: string) => void;
	onOther: () => void;
}) {
	const { models } = useHarnessModels(harness);
	const list =
		current && !models.includes(current) ? [current, ...models] : models;
	return (
		<>
			<DropdownMenuRadioGroup value={current ?? ""} onValueChange={onPick}>
				{list.map((model) => (
					<DropdownMenuRadioItem key={model} value={model} closeOnClick>
						{model}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={onOther}>Other model…</DropdownMenuItem>
		</>
	);
}

/** A model the list does not hold: the harness takes any model its CLI knows. */
export function OtherModelDialog({
	harness,
	label,
	initial,
	onClose,
	onPick,
}: {
	harness: HarnessName;
	label: string;
	initial: string;
	onClose: () => void;
	onPick: (model: string) => void;
}) {
	const id = useId();
	const [model, setModel] = useState(initial);
	return (
		<Dialog open onOpenChange={(open) => (open ? null : onClose())}>
			<DialogContent className="sm:max-w-sm">
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (model.trim()) onPick(model.trim());
					}}
				>
					<DialogHeader>
						<DialogTitle>Use another model</DialogTitle>
						<DialogDescription>
							Type the name of a model {label} supports. It does not need to be
							in the list.
						</DialogDescription>
					</DialogHeader>
					<Field>
						<FieldLabel htmlFor={id}>Model</FieldLabel>
						<ModelCombobox
							id={id}
							harness={harness}
							value={model}
							onChange={setModel}
						/>
					</Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={model.trim() === ""}>
							Use this model
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
