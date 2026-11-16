# 39. A page reader the person chooses reads the web

Status: accepted, 2026-11-16. Built, 2026-11-16.

## Context

The Web pages source (`kit:knowledge/web`) read every page through the free
reader at `r.jina.ai`. Every address a person added went to a third party, and
the free reader takes 20 requests a minute. A person could not choose a reader
they pay for or host, and could not keep the reading on their own computer.

The Knowledge page also needs a quick look at a link before it saves anything:
is it one page, the start of a section, a feed, a file, or a page that asks to
sign in? A sync that reads everything again each night also has no way to tell
that a page did not change.

## Decision

1. **One port, three adapters.** A page reader (`PageReader`,
   `packages/engine/src/knowledge/readers/reader.ts`) reads one page as
   Markdown and says how the read went: `read` (title, Markdown, every link of
   the page, a mark, the content type), `unchanged`, or `signin`, `gone`,
   `blocked`, `needs-browser`, `failed` with a reason in a person's words. An
   optional `map` lists the pages of a site. Any later reader is one more
   adapter.
   - **Night Shift** (`local.ts`, the default): Bun `fetch` on the computer
     that reads, with a User-Agent that names the product. HTML goes through
     linkedom and defuddle. PDF and Word files go through the knowledge's own
     loaders (ADR 16). An RSS, Atom, RDF or JSON feed becomes a page of its 30
     newest items (feedsmith, already a dependency). No headless browser: a
     page with almost no text after extraction and scripts is `needs-browser`.
     A 401, a redirect to a sign-in address, or a password field on a page
     with little text is `signin`. A 404 or 410 is `gone`.
   - **Jina Reader** (`jina.ts`): `GET <address><url>`, default
     `https://r.jina.ai/`, a self-hosted Reader allowed. An optional key goes
     as a Bearer token. It reads the Reader's text format and its `Warning:`
     line, as the kit did.
   - **Firecrawl** (`firecrawl.ts`): `POST <address>/v2/scrape` with the
     formats `markdown` and `links`, and `POST <address>/v2/map`. Default
     address `https://api.firecrawl.dev`, which needs a key. A self-hosted
     Firecrawl may need none. The page's own `metadata.statusCode` gives
     `gone`, `signin` and `blocked`.
2. **Every request follows the address rule.** The readers connect through
   the rule of every web request of this computer (`web-access`, moved out of
   `device/` for this). A Host reads its private network, or a self-hosted
   reader there, only when its Settings allow it.
3. **A per-project setting.** `reader: { kind, address?, secret? }` lives in
   the `settings` map of the knowledge document, beside `meaning` and
   `learnFromRuns`, so every Device of the Space reads the same way. Night
   Shift's own reader is the absence of the value. `secret` names the secret
   with the key (default `JINA_API_KEY`, `FIRECRAWL_API_KEY`). The Device that
   reads resolves it through the secret scopes of the step (ADR 13, ADR 18).
   A key is never in the setting, a flow or a kit's shell. The API sets it
   with `knowledge.setReader` (a role that may start runs) and shows it in
   `knowledge.get`.
4. **The kit keeps its crawl. Only the read goes through the reader.** A
   Command step of a project with knowledge gets `NS_READER_URL` and
   `NS_READER_TOKEN` from `Knowledge.forCommand`, next to `NS_KNOWLEDGE`.
   They name a route of the step on a loopback listener of the Device's own
   Night Shift process:
   - `GET <url>/read?url=…&fresh=` answers the page's file (front matter with
     `title` and `source`, then the Markdown) or the reason, and the status in
     the header `x-nightshift-read`. A header keeps the shell simple: no `jq`.
     `fresh=1` reads the page whole, for a page whose file is not there.
   - `GET <url>/links?url=…` gives every link the reader saw on that page, one
     per line, so a crawl follows the page's navigation too, also when the
     page did not change.
   - `GET <url>/map?url=…&limit=…` gives the pages a reader with a map
     lists, or 204. The kit uses it before its sitemap step.
   The kit keeps robots.txt, the sitemap, scope, limit, depth and its removal
   rules. Without `NS_READER_URL` (an older Device) it reads through
   `r.jina.ai` as before. A reader that does not answer fails the page: the
   kit never falls back to a third party on its own.
5. **Its own listener, not a route of the daemon's server.** The daemon's
   server listens on every interface on a Host, and a step needs only its
   own computer. The listener follows the lessons of the tool bridge: one
   `Bun.serve` on 127.0.0.1 per process, a path and a bearer token per step,
   a check before each step and every 2 s while steps are open, the same port
   when it opens again, and its state on `globalThis` across `bun --hot`.
6. **Change detection on the Device that reads.** The last read of each page
   (its ETag, Last-Modified, a sha256 fingerprint of its title and Markdown,
   and its links) is kept per project and reader in
   `<dataDir>/knowledge/.reads/<project>.json`, next to the search index. Like
   the index, it is this computer's cache of the knowledge, not part of it: it
   does not sync, and losing it costs one whole read of each page. The local
   reader sends `If-None-Match` and `If-Modified-Since`. A 304, or the same
   fingerprint, is `unchanged`, and the kit keeps the file. A service reads the
   whole page each time, so only its fingerprint can say `unchanged`.
7. **The quick look decides by the answer.** `knowledge.look({ projectId,
   urls })` gives one result per link: `page`, `section`, `feed`, `file`,
   `signin`, `media`, `gone`, `needs-browser`, `blocked` or `failed`, with a
   title, the section facts (its folder, how many pages, counted from the
   sitemap, the reader's map or the page's links, and whether the link starts
   the folder), the feed a page names, a feed's items a week, and a file's
   type. One cheap pass: one request for the page, robots.txt, at most 5
   sitemap files, 8 s per link, results kept 5 minutes. Media comes from the
   answer (an `audio/` or `video/` type, `og:video`, `og:audio`, `og:type`),
   never from a list of sites. When this computer cannot read a page and the
   project reads with a service, the service tries. A look is for a role that
   may save a source: it reads the web from the server.

## Library facts, checked on 2026-11-16

- `defuddle` 0.19.6 (MIT, kepano, published 2026-10-24). The Node entry is
  `defuddle/node`: `Defuddle(document, url, options)` takes any DOM
  `Document` (linkedom, JSDOM). `markdown: true` converts the content with
  turndown. `linkedom`, `turndown` and `temml` are its optional dependencies.
  Night Shift passes `useAsync: false`, so defuddle never asks a third party
  for what the page does not hold.
- `linkedom` 0.18.15 (ISC). `parseHTML(html).document`.
- Firecrawl: the current API is v2 (`https://api.firecrawl.dev/v2`). Scrape
  takes `formats` as strings (`"markdown"`, `"links"`) and answers
  `{ success, data: { markdown, links, metadata: { title, statusCode,
  contentType, url, sourceURL, error } } }`. Map answers `{ success, links }`,
  each link an object with `url` (and optional `title`, `description`). The
  brief named v1. Night Shift uses v2. The adapter takes a link as a string
  or an object.
- Jina Reader answers `Title:`, `URL Source:`, optional `Warning:` lines and
  `Markdown Content:`. A key goes as `Authorization: Bearer`. The Reader can
  be self-hosted (`ghcr.io/jina-ai/reader`).

## Consequences

- By default, the pages a person adds are read on their own computer, or on
  the Host that runs the sync. No address goes to a third party unless the
  person chooses Jina Reader or Firecrawl.
- A page that did not change keeps its file, so the reconcile has nothing
  to send for it.
- A page that needs a browser cannot be read by Night Shift's own reader. The
  person can choose a service, or let an agent fetch it (the agent source).
- `defuddle`, `linkedom` and `turndown` are new dependencies of the engine,
  and the compiled binary carries them.
- A self-hosted reader on a Host's private network needs the Host setting
  that allows the private network.
- The quick look runs outside a run, so it reads the key as a use outside a
  run does (ADR 13): from the secrets of the computer that answers.
