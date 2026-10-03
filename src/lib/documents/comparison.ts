export type Significance = "Low" | "Medium" | "High";
export type ClauseStatus = "unchanged" | "wording-only" | "materially-changed" | "added" | "removed";
export type ClauseMatchType = "number" | "heading" | "text" | "added" | "removed";

export interface ContractChange {
  label: string;
  sectionNumber: string | null;
  oldText: string;
  newText: string;
  status: Exclude<ClauseStatus, "unchanged">;
  significance: Significance;
  explanation: string;
}

export interface ClauseAlignment {
  sectionNumber: string | null;
  oldHeading: string;
  newHeading: string;
  matchType: ClauseMatchType;
  status: ClauseStatus;
  oldText: string;
  newText: string;
}

export interface ContractComparison {
  summary: string;
  changes: ContractChange[];
  alignments: ClauseAlignment[];
}

interface Clause {
  number: string | null;
  heading: string;
  text: string;
  body: string;
  index: number;
}

interface MatchedClause {
  oldClause: Clause | null;
  newClause: Clause | null;
  matchType: ClauseMatchType;
}

const STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "the", "to", "under", "with"]);
const NUMBER_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const NUMBER_VALUE = `(?:\\d+|${NUMBER_WORDS})(?:\\s*\\(\\s*\\d+\\s*\\))?`;
const NUMBERED_HEADING = /^\s*(?:(?:section|clause|article)\s+)?(\d+(?:\.\d+)*)(?:[.)])?\s+([A-Z][^\r\n]{0,100}?)\s*$/gm;
const NAMED_HEADING = /^([A-Z][\p{L}\p{N}&'’(),/-]*(?:\s+(?:and|of|to|for|in|on|the|[A-Z][\p{L}\p{N}&'’(),/-]*)){0,8})\s*$/gmu;

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function makeClausesFromHeadings(text: string, matches: RegExpMatchArray[]): Clause[] {
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const nextStart = matches[index + 1]?.index ?? text.length;
    const fullText = text.slice(start, nextStart).trim();
    const number = match[1]?.replace(/[.)]$/, "") ?? null;
    const heading = match[2]?.trim() ?? "";
    const headingEnd = (match[0] ?? "").length;
    return { number, heading, text: fullText, body: fullText.slice(headingEnd).trim(), index };
  }).filter((clause) => clause.text.length > 0);
}

function makeClausesFromNamedHeadings(text: string, matches: RegExpMatchArray[]): Clause[] {
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const nextStart = matches[index + 1]?.index ?? text.length;
    const fullText = text.slice(start, nextStart).trim();
    const heading = match[1]?.trim() ?? "";
    return { number: null, heading, text: fullText, body: fullText.slice((match[0] ?? "").length).trim(), index };
  }).filter((clause) => clause.text.length > 0);
}

function parseClauses(text: string): Clause[] {
  const numbered = [...text.matchAll(NUMBERED_HEADING)];
  if (numbered.length > 0) return makeClausesFromHeadings(text, numbered);

  const named = [...text.matchAll(NAMED_HEADING)].filter((match) => {
    const heading = match[1]?.trim() ?? "";
    return heading.length <= 80 && heading !== heading.toUpperCase();
  });
  if (named.length > 1) return makeClausesFromNamedHeadings(text, named);

  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return paragraphs.map((paragraph, index) => ({ number: null, heading: "", text: paragraph, body: paragraph, index }));
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function bestUniquePairs(oldClauses: Clause[], newClauses: Clause[], oldIndexes: number[], newIndexes: number[], scoreFor: (oldClause: Clause, newClause: Clause) => number, threshold: number): Array<[number, number]> {
  const candidates: Array<{ oldIndex: number; newIndex: number; score: number }> = [];
  for (const oldIndex of oldIndexes) {
    for (const newIndex of newIndexes) {
      const score = scoreFor(oldClauses[oldIndex], newClauses[newIndex]);
      if (score >= threshold) candidates.push({ oldIndex, newIndex, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.oldIndex - b.oldIndex || a.newIndex - b.newIndex);

  const pairedOld = new Set<number>();
  const pairedNew = new Set<number>();
  const pairs: Array<[number, number]> = [];
  for (const candidate of candidates) {
    if (pairedOld.has(candidate.oldIndex) || pairedNew.has(candidate.newIndex)) continue;
    const oldAlternatives = candidates.filter((entry) => entry.oldIndex === candidate.oldIndex && entry.newIndex !== candidate.newIndex);
    const newAlternatives = candidates.filter((entry) => entry.newIndex === candidate.newIndex && entry.oldIndex !== candidate.oldIndex);
    if (oldAlternatives.some((entry) => candidate.score - entry.score < 0.12)) continue;
    if (newAlternatives.some((entry) => candidate.score - entry.score < 0.12)) continue;
    pairedOld.add(candidate.oldIndex);
    pairedNew.add(candidate.newIndex);
    pairs.push([candidate.oldIndex, candidate.newIndex]);
  }
  return pairs;
}

function alignClauses(oldClauses: Clause[], newClauses: Clause[]): MatchedClause[] {
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const matched: MatchedClause[] = [];

  for (let oldIndex = 0; oldIndex < oldClauses.length; oldIndex += 1) {
    const oldClause = oldClauses[oldIndex];
    if (!oldClause.number) continue;
    const numberCandidates = newClauses
      .map((clause, index) => ({ clause, index }))
      .filter(({ clause, index }) => clause.number === oldClause.number && !usedNew.has(index));
    if (numberCandidates.length === 0) continue;

    const ranked = numberCandidates.sort((a, b) => similarity(oldClause.heading, b.clause.heading) - similarity(oldClause.heading, a.clause.heading));
    const candidate = ranked[0];
    const headingScore = similarity(oldClause.heading, candidate.clause.heading);
    const bodyScore = similarity(oldClause.body, candidate.clause.body);
    if (oldClause.heading && candidate.clause.heading && headingScore < 0.15 && bodyScore < 0.1) continue;
    usedOld.add(oldIndex);
    usedNew.add(candidate.index);
    matched.push({ oldClause, newClause: candidate.clause, matchType: "number" });
  }

  const remainingOld = oldClauses.map((_, index) => index).filter((index) => !usedOld.has(index));
  const remainingNew = newClauses.map((_, index) => index).filter((index) => !usedNew.has(index));
  const headingOld = remainingOld.filter((index) => oldClauses[index].heading.length > 0);
  const headingNew = remainingNew.filter((index) => newClauses[index].heading.length > 0);
  for (const [oldIndex, newIndex] of bestUniquePairs(oldClauses, newClauses, headingOld, headingNew, (a, b) => similarity(a.heading, b.heading), 0.55)) {
    usedOld.add(oldIndex);
    usedNew.add(newIndex);
    matched.push({ oldClause: oldClauses[oldIndex], newClause: newClauses[newIndex], matchType: "heading" });
  }

  const textOld = oldClauses.map((_, index) => index).filter((index) => !usedOld.has(index) && !oldClauses[index].heading);
  const textNew = newClauses.map((_, index) => index).filter((index) => !usedNew.has(index) && !newClauses[index].heading);
  for (const [oldIndex, newIndex] of bestUniquePairs(oldClauses, newClauses, textOld, textNew, (a, b) => similarity(a.text, b.text), 0.48)) {
    usedOld.add(oldIndex);
    usedNew.add(newIndex);
    matched.push({ oldClause: oldClauses[oldIndex], newClause: newClauses[newIndex], matchType: "text" });
  }

  for (let index = 0; index < oldClauses.length; index += 1) {
    if (!usedOld.has(index)) matched.push({ oldClause: oldClauses[index], newClause: null, matchType: "removed" });
  }
  for (let index = 0; index < newClauses.length; index += 1) {
    if (!usedNew.has(index)) matched.push({ oldClause: null, newClause: newClauses[index], matchType: "added" });
  }

  return matched.sort((a, b) => (a.newClause?.index ?? Number.MAX_SAFE_INTEGER) - (b.newClause?.index ?? Number.MAX_SAFE_INTEGER) || (a.oldClause?.index ?? Number.MAX_SAFE_INTEGER) - (b.oldClause?.index ?? Number.MAX_SAFE_INTEGER));
}

function facts(text: string): { amounts: string[]; durations: string[]; installments: string[] } {
  return {
    amounts: [...text.matchAll(/(?:₹|₨|\bINR\s*|\bRs\.?\s*|\bn(?=\s*[\d,]))\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi)].map((match) => match[1]),
    durations: [...text.matchAll(new RegExp(`\\b${NUMBER_VALUE}\\s+(?:calendar\\s+)?(?:months?|days?|years?)\\b`, "gi"))].map((match) => match[0].replace(/\s+/g, " ").trim()),
    installments: [...text.matchAll(new RegExp(`\\b${NUMBER_VALUE}\\s+(?:equal\\s+)?(?:installments?|instalments?)\\b`, "gi"))].map((match) => match[0].replace(/\s+/g, " ").trim()),
  };
}

function factChanges(oldText: string, newText: string): string[] {
  const oldFacts = facts(oldText);
  const newFacts = facts(newText);
  const descriptions: string[] = [];
  const describe = (oldValues: string[], newValues: string[], name: string) => {
    const count = Math.max(oldValues.length, newValues.length);
    for (let index = 0; index < count; index += 1) {
      const oldValue = oldValues[index];
      const newValue = newValues[index];
      if (normalize(oldValue ?? "") === normalize(newValue ?? "")) continue;
      if (oldValue && newValue) descriptions.push(`${name} changes from ${oldValue} to ${newValue}`);
      else if (newValue) descriptions.push(`${name} adds ${newValue}`);
      else if (oldValue) descriptions.push(`${name} removes ${oldValue}`);
    }
  };
  describe(oldFacts.amounts, newFacts.amounts, "Stated amount");
  describe(oldFacts.installments, newFacts.installments, "Instalment count");
  describe(oldFacts.durations, newFacts.durations, "Stated period");
  return descriptions;
}

function wordDelta(oldText: string, newText: string): { oldPart: string; newPart: string } {
  const oldWords = oldText.trim().split(/\s+/).filter(Boolean);
  const newWords = newText.trim().split(/\s+/).filter(Boolean);
  let prefix = 0;
  while (prefix < oldWords.length && prefix < newWords.length && normalize(oldWords[prefix]) === normalize(newWords[prefix])) prefix += 1;
  let suffix = 0;
  while (suffix < oldWords.length - prefix && suffix < newWords.length - prefix && normalize(oldWords[oldWords.length - suffix - 1]) === normalize(newWords[newWords.length - suffix - 1])) suffix += 1;
  return {
    oldPart: oldWords.slice(prefix, oldWords.length - suffix).join(" "),
    newPart: newWords.slice(prefix, newWords.length - suffix).join(" "),
  };
}

function explanationFor(label: string, oldText: string, newText: string, status: Exclude<ClauseStatus, "unchanged">): string {
  if (status === "added") return `This clause is present in Version B but not Version A.`;
  if (status === "removed") return `This clause is present in Version A but not Version B.`;

  if (/liabilit/i.test(label)) {
    const delta = wordDelta(oldText, newText);
    return `The liability cap changes from “${delta.oldPart}” to “${delta.newPart}”, changing the stated limit on liability.`;
  }

  const changedFacts = factChanges(oldText, newText);
  if (changedFacts.length > 0) {
    const impact = /termination/i.test(label)
      ? "This changes the notice period for ending the agreement."
      : /^term$/i.test(label)
        ? "This changes the agreement’s stated duration."
        : /fee|payment/i.test(label)
          ? "This changes the agreed fee or payment schedule."
          : "These values change the obligations stated in this clause.";
    return `${changedFacts.join("; ")}. ${impact}`;
  }

  const { oldPart, newPart } = wordDelta(oldText, newText);
  if (!oldPart && newPart) return `The revised clause adds “${newPart}” to ${label}.`;
  if (oldPart && !newPart) return `The revised clause removes “${oldPart}” from ${label}.`;
  return `The wording changes from “${oldPart}” to “${newPart}” in ${label}.`;
}

function significanceFor(label: string, status: Exclude<ClauseStatus, "unchanged">): Significance {
  if (status === "added" || status === "removed") return "Medium";
  if (/liabilit|indemnit|termination|intellectual property/i.test(label)) return "High";
  if (/fee|payment|term|notice|service/i.test(label)) return "Medium";
  return "Low";
}

function labelFor(alignment: ClauseAlignment): string {
  if (alignment.newHeading || alignment.oldHeading) return alignment.newHeading || alignment.oldHeading;
  if (alignment.sectionNumber) return `Section ${alignment.sectionNumber}`;
  const text = `${alignment.oldText} ${alignment.newText}`.toLowerCase();
  if (/liabilit|indemnit|cap/.test(text)) return "Liability Terms";
  if (/terminat|notice period/.test(text)) return "Termination Terms";
  if (/payment|invoice|instalment|installment|fees?/.test(text)) return "Payment Terms";
  if (/services?|scope|deliverables?/.test(text)) return "Services";
  return "Contract paragraph";
}

function classify(alignment: MatchedClause): ClauseStatus {
  if (!alignment.oldClause) return "added";
  if (!alignment.newClause) return "removed";
  if (normalize(alignment.oldClause.text) === normalize(alignment.newClause.text)) return "unchanged";
  const oldText = alignment.oldClause.text;
  const newText = alignment.newClause.text;
  if (factChanges(oldText, newText).length > 0) return "materially-changed";
  if (/\b(?:shall|must|may|will|is entitled to|is liable for)\b/i.test(oldText + newText) && normalize(oldText) !== normalize(newText)) {
    const oldModal = oldText.match(/\b(?:shall|must|may|will)\b/gi) ?? [];
    const newModal = newText.match(/\b(?:shall|must|may|will)\b/gi) ?? [];
    if (oldModal.join(" ").toLowerCase() !== newModal.join(" ").toLowerCase()) return "materially-changed";
  }
  if (/liabilit|indemnit|termination|cap|notice|fees?|payment/i.test(oldText + newText) && normalize(oldText) !== normalize(newText)) return "materially-changed";
  return "wording-only";
}

function toAlignment(match: MatchedClause, status: ClauseStatus): ClauseAlignment {
  const oldClause = match.oldClause;
  const newClause = match.newClause;
  return {
    sectionNumber: newClause?.number ?? oldClause?.number ?? null,
    oldHeading: oldClause?.heading ?? "",
    newHeading: newClause?.heading ?? "",
    matchType: match.matchType,
    status,
    oldText: oldClause?.text ?? "",
    newText: newClause?.text ?? "",
  };
}

export function compareContracts(oldText: string, newText: string): ContractComparison {
  const oldClauses = parseClauses(oldText);
  const newClauses = parseClauses(newText);
  const matches = alignClauses(oldClauses, newClauses);
  const alignments = matches.map((match) => toAlignment(match, classify(match)));
  const changes: ContractChange[] = alignments
    .filter((alignment): alignment is ClauseAlignment & { status: Exclude<ClauseStatus, "unchanged"> } => alignment.status !== "unchanged")
    .map((alignment) => {
      const label = labelFor(alignment);
      return {
        label,
        sectionNumber: alignment.sectionNumber,
        oldText: alignment.oldText,
        newText: alignment.newText,
        status: alignment.status,
        significance: significanceFor(label, alignment.status),
        explanation: explanationFor(label, alignment.oldText, alignment.newText, alignment.status),
      };
    });
  const summary = changes.length === 0
    ? "No clause-level changes were detected."
    : changes.map((change) => `${change.label}: ${change.explanation}`).join(" ");

  return { summary, changes, alignments };
}
