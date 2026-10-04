const ABSENCE_VERB = "(?:contain|include|state|specify|provide|establish|identify|set\\s+out|mention|address|grant|give|describe|show|indicate|list)";
const NEGATIVE_CLAIM = new RegExp(
  `\\b(?:does not|do not|doesn't|don't|isn't|is not|aren't|are not|can't|cannot|didn't|did not|hasn't|has not|haven't|have not|won't)\\s+${ABSENCE_VERB}\\b|\\b(?:there (?:is|are|was|were) no|(?:contains?|includes?|mentions?|states?|specifies?) no)\\b|\\bno (?:separate|additional|other|further|specific|express|explicit|such)\\b|\\b(?:absent|lacks?)\\b`,
  "i",
);

export function guardPartialCoverageAnswer(answer: string, coverage: "full" | "partial"): string {
  if (coverage === "full") return answer.trim();

  const sentences = answer.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [];
  const supportedScope = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !NEGATIVE_CLAIM.test(sentence));
  return supportedScope.join(" ") || "I couldn't find sufficient evidence in the sections I researched to answer confidently.";
}