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
  detail: string;
}

export const PROMPT_LIMITATIONS: PromptLimitation[] = [
  {
    title: "Speaker attribution: quoted-vs-endorsed positions",
    raisedBy: "Beta tester · 2026-06",
    detail:
      "Neither stage tracks who is speaking or whether the host endorses or rebuts a quote. Classify (v1) pulls a supporting quote of a substantive discussion; Score (v1) rates that quote on its face value (\"on its own merits\"). So when a host reads or plays an opposing position Y in order to attack it, the quote scores as aligned with Y - misattributing the show's actual stance X. Candidate for the next versions: have classify capture the speaker and an endorse/rebut stance, and have score reflect the host's stance toward the quote rather than the quote's surface alignment.",
  },
];
