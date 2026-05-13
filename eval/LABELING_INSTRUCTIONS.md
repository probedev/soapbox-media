# Soapbox.media — Independent Scoring Validation

## Background — what you're helping us calibrate

Soapbox.media is a data platform that quantifies what major alternative-media
political voices (podcasts and YouTube channels) are saying about specific
policy issues. Think of it as the FiveThirtyEight of alt-media political
discourse.

We take every episode our 50 tracked shows publish, transcribe it, and use a
language model to extract substantive mentions of political issues from a
defined taxonomy. Each mention then gets a **sentiment score** and an
**intensity score** — also assigned by a language model. We aggregate those
scores into a single L/R needle (the "Soapbox Index") and per-issue
contribution charts.

The integrity of the entire platform depends on those sentiment and intensity
scores being right. Right now those are produced by a language model, and we
have reason to suspect the model is making mistakes — specifically that it
treats the -5..+5 sentiment scale as a 3-way classifier (hard-left / neutral /
hard-right) instead of using the full gradient.

**Your job is to be a calibration ground-truth.** You'll score 50 real
mentions blindly, using your own judgment, on the same scales the model uses.
We'll compare your scores against the model's scores. Disagreements tell us
where the model is failing and how to fix the prompt.

We deliberately picked you because you're not inside our build process. Our
own scoring would have confirmation bias toward what the model already does.
Yours won't.

**Estimated time:** 2–3 hours. Score in one sitting if possible (calibration
drifts across days). Bias toward your gut — there are no trick questions.

## Your task

For each of 50 short quotes from political show transcripts, give us:

1. **A sentiment score** from -5 to +5 (integers only). This is how strongly
   the quote aligns with the LEFT vs. RIGHT position on the specific issue
   we've classified it under.
2. **An intensity score** from 1 to 5 (integers only). This is how strongly
   the speaker is expressing the view — passing remark vs. central argument.
3. **A confidence** from 1 to 3. 1 = "I'm guessing," 2 = "reasonably sure,"
   3 = "very confident."
4. **A free-text note** (optional) — only if something didn't fit cleanly,
   the quote was ambiguous, you couldn't tell what they meant, etc.

The channel name is intentionally hidden from you — only "L-coded channel,"
"M-coded channel," or "R-coded channel" appears in the source field. This
keeps your scoring focused on the quote itself rather than your priors about
the speaker.

## The issue taxonomy

For each quote, you'll see the issue we classified it under (e.g.,
"Immigration & border") plus the LEFT and RIGHT positions we've defined for
that issue. **Always use those positions as your anchors, not US political
stereotypes.** A quote sympathetic to Palestinian civilians scores negative
on the Israel–Gaza issue regardless of who said it; a quote arguing for
strong moderation of platforms scores negative on Free Speech & Moderation;
and so on.

The full taxonomy of 15 issues lives in the spreadsheet, but here's the
shape. Each row in the spreadsheet shows the issue's LEFT and RIGHT
positions so you don't have to context-switch:

- Immigration & border — More permissive vs. stricter enforcement
- Inflation & affordability — Government intervention vs. free-market
- Israel–Gaza — Palestinian-sympathetic vs. Israel-supportive
- Ukraine–Russia — Sustained aid vs. reduce/end aid
- China policy — Cooperation vs. hawkish containment
- Trump / GOP leadership — Critical vs. supportive
- Democratic Party leadership — Supportive vs. critical
- Transgender / LGBTQ policy — Affirming vs. restrictive
- Crime & public safety — Reform-oriented vs. tough-on-crime
- Election integrity — Expand access vs. stricter security
- AI & tech regulation — Stronger regulation vs. lighter-touch
- Free speech & moderation — Pro-moderation vs. anti-moderation
- Education & DEI — DEI-affirming vs. anti-DEI
- Abortion & reproductive rights — Pro-choice vs. pro-life
- Climate & energy — Aggressive climate action vs. energy abundance / skeptical

(Iran conflict is a 16th issue we added recently; if a quote was classified
there, treat LEFT = de-escalation/restraint, RIGHT = hawkish/military
response.)

## The sentiment scale

**Use the full -5 to +5 range. Use integers only.** Anchors at every integer:

- **-5**: Maximal alignment with the LEFT position. Argues for it directly,
  forcefully, no qualifiers. Could be on a campaign poster for the L side.
- **-4**: Very strong L alignment. Clearly arguing the L case, possibly with
  some moderation in tone.
- **-3**: Strong L alignment. Supportive of the L position with a clear
  framing.
- **-2**: Moderate L alignment. Leans L but with caveats, balance, or
  acknowledgment of the other side.
- **-1**: Mild L alignment. Slightly L-coded. Could go either way but
  marginally L.
- **0**: Genuinely neutral. Descriptive, balanced, or the quote is about
  the topic without taking a position.
- **+1**: Mild R alignment. Slightly R-coded.
- **+2**: Moderate R alignment.
- **+3**: Strong R alignment.
- **+4**: Very strong R alignment.
- **+5**: Maximal R alignment.

**Key guidance:** Do not skip the middle of the scale. A "mild" quote should
be -1 or +1, NOT -3 or +3. Most political talk is not extreme; if you find
yourself mostly using ±5, recalibrate. Real political speech distributes
across the scale.

## The intensity scale

- **1**: Passing remark. Brief mention, casual reference, half a sentence.
- **2**: Clear but brief statement. One or two sentences expressing a view.
- **3**: Deliberate, well-formed statement of opinion.
- **4**: Strongly emphasized. Repeated, returned to, or core to surrounding
  discussion.
- **5**: Passionate, extensive, the central argument of the segment. The
  whole reason this episode was made.

Sentiment and intensity are independent. A passing remark can be extremely
L-aligned (-5, intensity 1). A passionate argument can be moderate (-2,
intensity 5).

## Rules and edge cases

- **Quote-only judgment.** You don't have the surrounding context. Score
  what's in the quote. If you genuinely can't tell what they mean, score 0
  and lower your confidence.
- **The classifier may have wrong-issued a quote.** If a quote is in the
  "Immigration & border" row but it's actually about something else, flag
  it in the notes column and score 0 with low confidence. We want to know
  this too.
- **Sarcasm and irony.** Score what they actually mean, not the literal
  words. If they're mocking the R position, that's L-coded.
- **Quoting an opponent.** If they're paraphrasing someone they disagree
  with to mock or criticize that view, score it as alignment with the
  opposite side, not the side they're quoting.
- **"Both sides bad."** True both-sidesism scores 0. False both-sidesism
  (criticizing one side harder while feigning balance) scores toward the
  side they're actually criticizing more.
- **Foreign-policy stuff is hard.** US politics doesn't always map cleanly
  to L/R on issues like Ukraine or Iran. Use the definitions in the
  spreadsheet, not your gut.

## Calibration examples

Three fully-scored examples to ground you. These appear at the top of the
spreadsheet so you can refer back as you work.

**Example 1** — Issue: Immigration & border. L position: permissive +
humanitarian. R position: stricter enforcement.
> "We have to stop pretending the border is fine. Hundreds of thousands of
> people are coming in every month with no vetting, and it's destroying the
> wages of working-class Americans who play by the rules."
- Sentiment: **+4** (strong R alignment — argues for stricter enforcement,
  frames migration as a problem)
- Intensity: **3** (clearly stated, deliberate, not a throwaway)
- Confidence: **3**

**Example 2** — Issue: Free speech & moderation. L position: pro-moderation
to limit harm. R position: anti-moderation, free-speech absolutist.
> "Look, I get the concern about misinformation, I do. But once you give the
> government or these tech platforms the power to decide what's true, you've
> handed them a weapon they will absolutely abuse."
- Sentiment: **+3** (strong R alignment — argues against moderation, frames
  it as government overreach, but acknowledges the L concern)
- Intensity: **3** (deliberate, central to the speaker's point)
- Confidence: **3**

**Example 3** — Issue: Trump / GOP leadership. L position: critical. R
position: supportive.
> "There's a lot to criticize about how this administration has handled the
> tariffs, but I don't think it's the disaster the media is making it out
> to be."
- Sentiment: **+1** (mild R alignment — defending the administration, but
  acknowledging real criticism)
- Intensity: **2** (brief and qualified statement of view)
- Confidence: **2** (the quote is on the line between mild support and
  centrist)

## How to do the labeling

1. Open the Google Sheets we'll send (link will be in the email).
2. Read these instructions in full, including the three examples above.
3. Work through the 50 rows top to bottom. Each row is one mention.
4. Fill in: sentiment, intensity, confidence, optional notes.
5. Don't go back and adjust earlier rows once you've moved past them —
   we want fresh judgment per row.
6. When done, reply to confirm. We'll pull the data and run the comparison.

If anything is confusing about the instructions, ask before starting. Once
you start, please don't look at our existing scores or talk to Gregg about
specific rows — that defeats the purpose of independent calibration.

Thank you. This makes the whole platform more defensible.
