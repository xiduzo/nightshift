import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { knowledgeQueries } from "./queries";

/** How long the words rest before the search runs, in ms. */
const TYPING_PAUSE = 250;

/** A search over the project's knowledge, once the typing rests. */
export function useKnowledgeHits(projectId: string) {
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim()), TYPING_PAUSE);
		return () => clearTimeout(timer);
	}, [text]);

	const hits = useQuery({
		...knowledgeQueries.search(projectId, query),
		enabled: query !== "",
		placeholderData: keepPreviousData,
	});

	return {
		text,
		setText,
		query,
		hits,
		clear: () => {
			setText("");
			setQuery("");
		},
	};
}
