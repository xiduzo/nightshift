/** The pull request scores: what became of the pull request a run opened, written as Scores of that run. A webhook of GitHub brings the news, and a check each morning asks `gh pr view` for it. */

export { createPullRequestScores } from "./pull-request-scores";
export type { PullRequestReader, PullRequestView } from "./pull-request-watch";
export { createPullRequestWatch } from "./pull-request-watch";
