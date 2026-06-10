/**
 * Read-only catalog of the LLM prompts + models the pipeline runs, for the
 * /admin/prompts page. Prompt templates are rendered from the REAL builders
 * (with placeholder inputs), so this surface can never drift from what actually
 * runs in production. As the platform matures, bump the per-stage
 * *_PROMPT_VERSION next to each builder, and validate any classify/score change
 * against the gold set first (CLAUDE.md).
 */
import { MODEL_CLASSIFY, MODEL_SCORE } from "@/lib/anthropic";
import {
  CLASSIFY_PROMPT_VERSION,
  CLASSIFY_MAX_TOKENS,
  classifyPromptPreview,
} from "@/modules/classify";
import {
  SCORE_PROMPT_VERSION,
  SCORE_MAX_TOKENS,
  scorePromptPreview,
} from "@/modules/score";

export interface PromptSpec {
  stage: "classify" | "score";
  title: string;
  model: string;
  version: string;
  maxTokens: number;
  description: string;
  /** The dynamic slots interpolated into the template at run time. */
  dynamicInputs: string[];
  /** The prompt template with dynamic slots shown as {{PLACEHOLDERS}}. */
  prompt: string;
}

export function getPromptCatalog(): PromptSpec[] {
  return [
    {
      stage: "classify",
      title: "Classify",
      model: MODEL_CLASSIFY,
      version: CLASSIFY_PROMPT_VERSION,
      maxTokens: CLASSIFY_MAX_TOKENS,
      description:
        "Reads a full transcript and extracts substantive (issue, supporting-quote) mentions against the active taxonomy, plus off-taxonomy topics that feed emerging-issue discovery.",
      dynamicInputs: [
        "{{ISSUE TAXONOMY}} - one line per active issue (slug, name, definition)",
        "{{TRANSCRIPT}} - the full episode transcript",
        "channel name, editorial lean, episode title, published date",
      ],
      prompt: classifyPromptPreview(),
    },
    {
      stage: "score",
      title: "Score",
      model: MODEL_SCORE,
      version: SCORE_PROMPT_VERSION,
      maxTokens: SCORE_MAX_TOKENS,
      description:
        "Rates one supporting quote on the left-right alignment (-5..+5) and the intensity of the view (1..5) for its issue.",
      dynamicInputs: [
        "{{QUOTE}} - the supporting quote produced by classify",
        "issue name + definition",
        "the left-leaning and right-leaning reference positions",
        "channel name + editorial lean",
      ],
      prompt: scorePromptPreview(),
    },
  ];
}

/** A known validity gap in the current prompts - the maturation backlog shown
 *  on /admin/prompts. Each is a candidate for the next prompt version and must
 *  be validated against the gold set before shipping. */
export interface PromptLimitation {
  title: string;
  raisedBy?: string;
  /** Short lifecycle tag, e.g. "Open", "Investigated & parked (2026-06)". */
  status?: string;
  detail: string;
}

export const PROMPT_LIMITATIONS: PromptLimitation[] = [
  {
    title: "Speaker attribution: quoted-vs-endorsed positions",
    raisedBy: "Beta tester · 2026-06",
    status: "Investigated & parked (2026-06)",
    detail:
      "The concern: neither stage tracks whether the host endorses or rebuts a quote, so a host reading/playing an opposing position Y to attack it could be scored as aligned with Y. Investigated offline (a 90-transcript classify battery + a separate stance-stage prototype run over real production mentions; harnesses in scripts/eval-attribution.ts and scripts/eval-stance-impact.ts). Findings: genuine opposing-position quotes are only ~8% of mentions - a sharpened definition cut a naive 41% over-count, because a host's OWN criticism of an opponent is the host's view, not the opponent's. Crucially, correcting attribution barely moves the per-channel-per-issue scores the site reports: mean |delta| < 1 pt on the -10..+10 scale, no strongly-stanced channel changed its read, and the only sign-flips were near-zero legacy-news pairs (BBC / Bloomberg on Iran) where balanced is balanced either way. Inferring 'whose stance' without speaker labels is also error-prone (it can flag a guest the show AGREES with as 'opposing'), so a naive fix could make some channels worse. Decision: PARKED - a per-mention stance stage + schema + gold-set re-validation isn't justified by a sub-point refinement. Revisit only if a specific high-value channel shows a demonstrable mis-attribution.",
  },
];
