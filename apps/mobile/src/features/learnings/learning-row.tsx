import { agoLabel, useRunPrefetch } from "@nightshift/client";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@nightshift/ui-native/components/ui/alert-dialog";
import {
	Button,
	buttonTextVariants,
	buttonVariants,
} from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import {
	Text,
	TextClassContext,
} from "@nightshift/ui-native/components/ui/text";
import { Link } from "expo-router";
import { Check, ChevronRight, Trash2 } from "lucide-react-native";
import { memo } from "react";
import { View } from "react-native";

import { useSignedIn } from "@/features/host";
import { useClock } from "@/shared/clock";
import type { Learning } from "./waiting";

/**
 * One step's learnings that wait: its notes, when the agent proposed
 * them, the run they came from, and Keep or Delete. Delete asks first.
 * Keep waits for notes you can read.
 */
export const LearningRow = memo(function LearningRow({
	learning,
	projectName,
	onKeep,
	onDelete,
}: {
	learning: Learning;
	/** Its project, on the list of every project. Null on a project's own list. */
	projectName: string | null;
	onKeep: (learning: Learning) => void;
	onDelete: (learning: Learning) => void;
}) {
	const now = useClock(60_000);
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const readable = learning.notes.length > 0;

	return (
		<View className="gap-3 px-4 py-4">
			<View className="gap-1">
				<Text className="text-muted-foreground text-xs">
					{projectName
						? `${projectName} · ${agoLabel(learning.proposedAt, now)}`
						: agoLabel(learning.proposedAt, now)}
				</Text>
				{readable ? (
					learning.notes.map((note, index) => (
						// The notes keep their order, and the same note may come twice.
						<Text key={index} selectable>
							{learning.notes.length > 1 ? `• ${note}` : note}
						</Text>
					))
				) : (
					<Text className="text-muted-foreground">
						The text of this learning cannot be read now. Pull down to try
						again.
					</Text>
				)}
			</View>
			<Link
				href={{ pathname: "/runs/[runId]", params: { runId: learning.runId } }}
				asChild
			>
				<Button
					size="lg"
					variant="link"
					className="h-auto min-h-11 self-start px-0 py-2"
					onPressIn={() => prefetch(learning.runId)}
					accessibilityHint="Opens the run this learning came from"
				>
					<Text className="text-muted-foreground">From this run</Text>
					<Icon as={ChevronRight} className="text-muted-foreground" />
				</Button>
			</Link>
			<View className="flex-row flex-wrap gap-2">
				<Button
					size="lg"
					className="h-auto min-h-11 py-2"
					disabled={!readable}
					onPress={() => onKeep(learning)}
					accessibilityHint="Agents read it in later runs"
				>
					<Icon as={Check} />
					<Text>Keep</Text>
				</Button>
				<DeleteButton onConfirm={() => onDelete(learning)} />
			</View>
		</View>
	);
});

/** Delete, after an Alert Dialog asks. */
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button size="lg" variant="outline" className="h-auto min-h-11 py-2">
					<Icon as={Trash2} />
					<Text>Delete</Text>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent className="w-[90%]">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete this learning?</AlertDialogTitle>
					<AlertDialogDescription>
						Agents do not get it. You cannot undo this.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Text>Cancel</Text>
					</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "destructive" })}
						onPress={onConfirm}
					>
						{/* The Action gives its className to the text too: the label takes the text classes of its variant only. */}
						<TextClassContext.Provider
							value={buttonTextVariants({ variant: "destructive" })}
						>
							<Text>Delete</Text>
						</TextClassContext.Provider>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
