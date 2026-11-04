/**
 * The topics of a project's knowledge, by counting words: the words and the
 * two-word phrases that several files share and that say the most about them.
 * No model reads the text. Nothing here knows a language beyond its short
 * words, so English and Dutch text count the same way.
 *
 * The rules that lift it above a plain word count, each measured on this
 * repository's docs (`docs/knowledge.md`, "The Map"):
 *
 * - One word, one topic: a plural folds into its singular, when the text has
 *   both (`singularsOf`).
 * - Two words that stand together more than chance would say are one topic,
 *   and a word that mostly stands in its phrase gives way to the phrase.
 * - A person's word goes first: what they marked "not a topic" takes no
 *   place, and the next word takes it.
 *
 * A small rule, on purpose: stemmers and keyphrase libraries for JavaScript
 * know one language, and this needs no more than the plural.
 */

/** A file and its text. */
export type TextOfFile = { path: string; text: string };

/** What the topics of some files are. */
export type FoundTopics = {
	/** Each topic by its key, as the text writes it. */
	topics: Map<string, string>;
	/** The topics of a file, by path, the most named first. */
	ofFile: Map<string, string[]>;
	/** The keys of the topics a text names, as whole words, in any case. */
	namedIn(text: string): string[];
};

/** The topics of a whole Map, at most. */
const MAX_TOPICS = 24;
/** The topics one file connects to, at most. */
const TOPICS_PER_FILE = 6;
/** A topic in more of the files than this says nothing about one of them. */
const MOST_OF_THE_FILES = 0.7;
/** A plain word shorter than this is seldom a topic. A name can be shorter: CAGR. */
const MIN_WORD = 5;
/** A name shorter than this is seldom one: a stray capital. */
const MIN_NAME = 3;
/** How often two words stand together, against the rarer word's count, to be one topic. */
const PHRASE_SHARE = 0.2;
/** A word that stands in its phrases this often gives way to them. */
const COVERED_SHARE = 0.6;
/** What a name or a phrase counts for, against a plain word. */
const NAME_WEIGHT = 2;
/** A phrase says more than a word, but stands in fewer files. */
const PHRASE_WEIGHT = 2;

const wordsOf = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

/** The short words of English and Dutch: never a topic, and a phrase stops at one. */
const FUNCTION_WORDS = wordsOf(
	`a about above after again against all almost along already also although always am among an and
	another any are as at be because been before being below between both but by can could did do does
	doing done down during each either enough even every few for from further get gets got had has have
	having he her here him his how however i if in into is it its itself just like many may me might
	more most much must my near need needs never next no none non nor not now of off often on once one
	only onto or other others our out over own re same she should since so some still such than that
	the their them then there therefore these they this those though through thus to together too under
	until up upon us very was we were what when where which while who whole whose why will with within
	without would you your use used uses using make makes made see two three first second
	aan af al alle alles als altijd ander andere anders bij binnen daar daarna daarom dan dat de deze
	die dit doch doen door dus een eens eerst en er ge geen geweest haar had heb hebben heeft hem het
	hier hij hoe hun iedere iemand iets ik in is ja je jij jou jouw jullie kan kon kunnen maar me meer
	men met mij mijn moet moeten na naar nee niet niets nog nu of om omdat ons onder onze ook op over
	reeds sinds staan staat te tegen toch toen tot tussen u uit uw van veel voor vooral waar want waren
	was wat we wel welke werd wie wij wil worden wordt zal ze zei zelf zich zij zijn zo zoals zodat
	zonder zou`,
);

/** Words of web pages, of writing about writing, and everyday verbs: no topic alone, fine in a phrase. */
const NOT_ALONE = wordsOf(
	`answer based data result table figure page http https www html menu search privacy cookie login
	subscribe contact home share blog post read note file title time show shown high higher low lower
	large small great good best better example article research paper author abstract keyword download
	view click link section panel fig month monthly daily weekly annual annually sample source window
	publication published address year know want write wait start need name call add keep find take
	give ask say work change end stop january february march april june july august september october
	november december jan feb mar apr jun jul aug sep sept oct nov dec`,
);

/** A word, a line's end that is not a sentence wrapped, or anything else that stops a phrase. */
const TOKEN = /\p{L}[\p{L}\p{N}]*|\n(?![ \t]*\p{Ll})|\S/gu;
const STARTS_WITH_LETTER = /^\p{L}/u;

/** What takes the place of code: words on either side make no phrase. */
const STOP = " . ";

/** Text without code, links and markup. */
function plainText(text: string): string {
	return text
		.replace(/```[\s\S]*?(?:```|$)/g, STOP)
		.replace(/`[^`\n]*`/g, STOP)
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/https?:\/\/\S+/g, STOP)
		.replace(/[#*_>~=-]+/g, " ");
}

/** Whether a token is a word of two letters or more. */
function isWordToken(token: string): boolean {
	if (token.length < 2) return false;
	const first = token.charCodeAt(0);
	if (first >= 128) return STARTS_WITH_LETTER.test(token);
	return (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
}

/** Calls `each` per word: `at` counts from the last stop, so 0 is a sentence's first word. */
function eachWord(
	text: string,
	each: (word: string, at: number) => void,
	stopped: () => void,
): void {
	let at = 0;
	for (const [token] of plainText(text).matchAll(TOKEN)) {
		if (!isWordToken(token)) {
			stopped();
			at = 0;
			continue;
		}
		each(token, at);
		at++;
	}
	stopped();
}

/**
 * The singulars a word may be the plural of, in English and Dutch. Only a form
 * the text also has counts (`foldOf`), which keeps these rules small and safe.
 */
function singularsOf(word: string): string[] {
	const out: string[] = [];
	if (word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
	if (/(?:s|x|z|ch|sh)es$/.test(word)) out.push(word.slice(0, -2));
	if (word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) {
		out.push(word.slice(0, -1));
	}
	if (word.endsWith("en") && word.length >= 6) {
		const stem = word.slice(0, -2);
		out.push(stem);
		// modellen, model.
		if (stem.at(-1) === stem.at(-2)) out.push(stem.slice(0, -1));
	}
	return out;
}

/**
 * Whether a person marked a key, in whichever number they saw it. Ready once,
 * for it runs for every word of every file. None marked: no rule runs at all.
 */
function markedBy(marked: ReadonlySet<string>): (key: string) => boolean {
	if (marked.size === 0) return () => false;
	const forms = new Set(marked);
	for (const word of marked) {
		for (const form of singularsOf(word)) forms.add(form);
	}
	return (key) =>
		forms.has(key) || singularsOf(key).some((form) => marked.has(form));
}

const hasCapital = (text: string) => text !== text.toLowerCase();
const startsCapital = (word: string) => hasCapital(word.charAt(0));
/** ETF, ETFs: more than one capital in front. */
const isAcronym = (word: string) =>
	startsCapital(word) && hasCapital(word.charAt(1));

function raise<K>(counts: Map<K, number>, key: K, by: number) {
	counts.set(key, (counts.get(key) ?? 0) + by);
}

/** Adds up per key, under another key. */
function foldCounts(
	counts: Map<string, number>,
	fold: (key: string) => string,
): Map<string, number> {
	const out = new Map<string, number>();
	for (const [key, count] of counts) raise(out, fold(key), count);
	return out;
}

/** The form most written. A tie goes to the one with a capital: the name. */
function mostWritten(forms: Map<string, number>): string | undefined {
	return [...forms].sort(
		(a, b) =>
			b[1] - a[1] ||
			Number(hasCapital(b[0])) - Number(hasCapital(a[0])) ||
			a[0].localeCompare(b[0]),
	)[0]?.[0];
}

/** Finds the topics of the files. `notTopics`: what a person marked, in lower case. */
export function findTopics(
	files: readonly TextOfFile[],
	notTopics: ReadonlySet<string> = new Set(),
): FoundTopics {
	const isMarked = markedBy(notTopics);
	/** Every word of all texts, by lower case, with how often it stands there. */
	const vocabulary = new Map<string, number>();
	/** How many times each word and phrase stands, by lower case. */
	const standing = new Map<string, number>();
	/** The ways a word or phrase is written with capitals. Most of a text has none, so this stays small. */
	const capitals = new Map<string, Map<string, number>>();
	const wrote = (key: string, form: string, by: number) => {
		raise(standing, key, by);
		if (form === key) return;
		let forms = capitals.get(key);
		if (!forms) {
			forms = new Map();
			capitals.set(key, forms);
		}
		raise(forms, form, by);
	};

	const counted = files.map((file) => {
		const words = new Map<string, number>();
		const phrases = new Map<string, number>();
		let before: string | null = null;
		eachWord(
			file.text,
			(word, at) => {
				const key = word.toLowerCase();
				if (FUNCTION_WORDS.has(key)) {
					before = null;
					return;
				}
				raise(vocabulary, key, 1);
				const capital = startsCapital(word);
				// The first word of a sentence has a capital for no reason.
				if (capital && (at > 0 || isAcronym(word)) && word.length >= MIN_NAME) {
					raise(words, key, NAME_WEIGHT);
					wrote(key, word, NAME_WEIGHT);
				} else if (!capital && word.length >= MIN_WORD) {
					raise(words, key, 1);
					wrote(key, word, 1);
				}
				if (before !== null) {
					const phrase = `${before.toLowerCase()} ${key}`;
					raise(phrases, phrase, 1);
					// A sentence's capital is not how the phrase is written.
					const name = at > 1 || capital || isAcronym(before);
					wrote(phrase, `${name ? before : before.toLowerCase()} ${word}`, 1);
				}
				before = word;
			},
			() => {
				before = null;
			},
		);
		return { words, phrases };
	});

	/** A word's key: its singular, when the text has that too. */
	const foldedWords = new Map<string, string>();
	const foldOf = (word: string): string => {
		let folded = foldedWords.get(word);
		if (folded === undefined) {
			folded = singularsOf(word).find((form) => vocabulary.has(form)) ?? word;
			foldedWords.set(word, folded);
		}
		return folded;
	};
	const foldedPhrases = new Map<string, string>();
	const foldPhrase = (phrase: string): string => {
		let folded = foldedPhrases.get(phrase);
		if (folded === undefined) {
			const [a = "", b = ""] = phrase.split(" ");
			folded = `${foldOf(a)} ${foldOf(b)}`;
			foldedPhrases.set(phrase, folded);
		}
		return folded;
	};
	/** How many times a word stands in the texts, in either number. */
	const total = foldCounts(vocabulary, foldOf);
	const texts = counted.map(({ words, phrases }) => ({
		words: foldCounts(words, foldOf),
		phrases: foldCounts(phrases, foldPhrase),
	}));

	/** In how many files a word or a phrase stands. */
	const seenIn = new Map<string, number>();
	const phraseTotal = new Map<string, number>();
	for (const { words, phrases } of texts) {
		for (const key of words.keys()) raise(seenIn, key, 1);
		for (const [key, count] of phrases) {
			raise(seenIn, key, 1);
			raise(phraseTotal, key, count);
		}
	}

	/** Two words of several files that stand together far more than the rarer one stands alone. */
	const isPhrase = (key: string): boolean => {
		if ((seenIn.get(key) ?? 0) < 2 || isMarked(key)) return false;
		const [a = "", b = ""] = key.split(" ");
		const rarer = Math.min(total.get(a) ?? 1, total.get(b) ?? 1);
		return (phraseTotal.get(key) ?? 0) / rarer >= PHRASE_SHARE;
	};
	const kept = new Set([...phraseTotal.keys()].filter(isPhrase));
	/** How many of a word's places its phrases hold. */
	const inPhrases = new Map<string, number>();
	for (const key of kept) {
		const [a = "", b = ""] = key.split(" ");
		raise(inPhrases, a, phraseTotal.get(key) ?? 0);
		raise(inPhrases, b, phraseTotal.get(key) ?? 0);
	}
	const isWord = (key: string): boolean =>
		!NOT_ALONE.has(key) &&
		!isMarked(key) &&
		(inPhrases.get(key) ?? 0) / (total.get(key) ?? 1) < COVERED_SHARE;

	const most = Math.max(2, Math.ceil(files.length * MOST_OF_THE_FILES));
	const scores = new Map<string, number>();
	const ofText = texts.map(({ words, phrases }) => {
		const counts = new Map<string, number>();
		for (const [key, count] of words) {
			if (isWord(key)) counts.set(key, count);
		}
		for (const [key, count] of phrases) {
			if (kept.has(key)) counts.set(key, count * NAME_WEIGHT);
		}
		for (const [key, count] of counts) {
			const seen = seenIn.get(key) ?? 0;
			if (seen < 2 || seen > most) continue;
			raise(
				scores,
				key,
				(key.includes(" ") ? PHRASE_WEIGHT : 1) *
					Math.log1p(count) *
					Math.log1p(files.length / seen),
			);
		}
		return counts;
	});

	const chosen = [...scores]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, Math.min(MAX_TOPICS, Math.ceil(files.length * 1.5)))
		.map(([key]) => key);
	const topics = new Map<string, string>();
	const formsOf = (spelled: string): Map<string, number> => {
		const forms = new Map(capitals.get(spelled));
		let capitalised = 0;
		for (const count of forms.values()) capitalised += count;
		const plain = (standing.get(spelled) ?? 0) - capitalised;
		if (plain > 0) forms.set(spelled, plain);
		return forms;
	};
	// The singular is the name. Another number only when the text has no other.
	const otherNumber = new Map<string, string>();
	const wanted = new Set(chosen);
	for (const spelled of standing.keys()) {
		const key = spelled.includes(" ") ? foldPhrase(spelled) : foldOf(spelled);
		if (key !== spelled && wanted.has(key)) otherNumber.set(key, spelled);
	}
	for (const key of chosen) {
		const spelled = standing.has(key) ? key : (otherNumber.get(key) ?? key);
		topics.set(key, mostWritten(formsOf(spelled)) ?? key);
	}

	return {
		topics,
		ofFile: new Map(
			files.map((file, index) => [
				file.path,
				[...(ofText[index] ?? [])]
					.filter(([key]) => topics.has(key))
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
					.slice(0, TOPICS_PER_FILE)
					.map(([key]) => key),
			]),
		),
		namedIn(text) {
			const named = new Set<string>();
			let before: string | null = null;
			eachWord(
				text,
				(word) => {
					const key = foldOf(word.toLowerCase());
					if (topics.has(key)) named.add(key);
					const phrase = `${before} ${key}`;
					if (before !== null && topics.has(phrase)) named.add(phrase);
					before = key;
				},
				() => {
					before = null;
				},
			);
			return [...named];
		},
	};
}
