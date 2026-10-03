export type Significance = "Low" | "Medium" | "High";

export interface ContractChange {
  label: string;
  oldText: string;
  newText: string;
  significance: Significance;
  explanation: string;
}

export interface ContractComparison {
  summary: string;
  changes: ContractChange[];
}

const KEYWORD_GROUPS = [
  { label: "Liability Cap", keywords: ["liability", "cap", "limit", "damages", "indemnify", "indemnity"], significance: "High" },
  { label: "Payment Terms", keywords: ["payment", "invoice", "pay", "days", "fees", "amount"], significance: "Medium" },
  { label: "Termination Rights", keywords: ["termination", "terminate", "end", "breach", "notice period"], significance: "High" },
  { label: "Confidentiality", keywords: ["confidential", "non-disclosure", "protection", "trade secret"], significance: "High" },
  { label: "Governing Law", keywords: ["governing law", "jurisdiction", "court", "dispute"], significance: "Medium" },
  { label: "Warranties", keywords: ["warranty", "warranties", "representation", "fitness"], significance: "Medium" },
];

function normalizeClause(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function clampText(value: string, max = 180): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function detectLabel(oldText: string, newText: string): string {
  const combined = `${oldText} ${newText}`.toLowerCase();
  for (const group of KEYWORD_GROUPS) {
    if (group.keywords.some((keyword) => combined.includes(keyword))) return group.label;
  }
  return "Contract Terms";
}

function detectSignificance(oldText: string, newText: string): Significance {
  const combined = `${oldText} ${newText}`.toLowerCase();
  const highKeywords = ["liability", "termination", "indemnify", "confidential", "exclusive", "cap", "damages", "penalty", "termination rights"];
  const mediumKeywords = ["payment", "days", "invoice", "notice", "fee", "governing law", "deadline", "warranty"];
  if (highKeywords.some((keyword) => combined.includes(keyword))) return "High";
  if (mediumKeywords.some((keyword) => combined.includes(keyword))) return "Medium";
  return "Low";
}

function extractNumbers(value: string): number[] {
  return [...value.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map((match) => Number(match[0].replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

function buildExplanation(oldText: string, newText: string): string {
  const oldClean = oldText.trim();
  const newClean = newText.trim();
  const oldNumbers = extractNumbers(oldClean);
  const newNumbers = extractNumbers(newClean);

  if (/payment|invoice|days|pay|fees|amount/.test(oldClean + newClean) && oldNumbers.length && newNumbers.length) {
    const oldValue = oldNumbers[0];
    const newValue = newNumbers[0];
    return `The payment period was adjusted from ${oldValue} to ${newValue}, changing the operational timeline for payment.`;
  }

  if (/liability|cap|limit/.test(oldClean + newClean) && oldNumbers.length && newNumbers.length) {
    return `The liability limit changed from ${oldNumbers[0]} to ${newNumbers[0]}, materially altering the financial risk allocation.`;
  }

  if (oldClean && newClean) {
    return `The contract language was revised from “${clampText(oldClean, 80)}” to “${clampText(newClean, 80)},” which changes the legal obligation in a meaningful way.`;
  }

  return "The clause was revised in a way that materially changes the contract obligations.";
}

function splitClauses(value: string): string[] {
  return value
    .split(/\n{2,}|\.(?=\s+[A-Z])|\n(?=\s*(?:Section|Clause|Article|Payment|Liability|Termination|Confidentiality|Warranty))/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 12);
}

export function compareContracts(oldText: string, newText: string): ContractComparison {
  const oldClauses = splitClauses(oldText);
  const newClauses = splitClauses(newText);
  const changes: ContractChange[] = [];

  if (!oldClauses.length || !newClauses.length) {
    return {
      summary: oldText === newText ? "No material contract changes were detected." : "The contract text changed materially, but the clause structure could not be aligned automatically.",
      changes: oldText === newText ? [] : [{
        label: "Contract Terms",
        oldText: clampText(oldText),
        newText: clampText(newText),
        significance: "Medium",
        explanation: "The contract wording changed in a way that requires a legal review.",
      }],
    };
  }

  const matched = new Set<number>();
  for (let i = 0; i < newClauses.length; i += 1) {
    const candidate = newClauses[i];
    let bestMatch = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let j = 0; j < oldClauses.length; j += 1) {
      if (matched.has(j)) continue;
      const oldClause = oldClauses[j];
      const similarity = Math.abs(normalizeClause(candidate).length - normalizeClause(oldClause).length);
      if (similarity < bestScore) {
        bestScore = similarity;
        bestMatch = j;
      }
    }

    if (bestMatch >= 0) {
      const oldClause = oldClauses[bestMatch];
      const oldNorm = normalizeClause(oldClause);
      const newNorm = normalizeClause(candidate);
      if (oldNorm !== newNorm && !oldNorm.includes(newNorm.slice(0, Math.min(30, newNorm.length))) && !newNorm.includes(oldNorm.slice(0, Math.min(30, oldNorm.length)))) {
        const label = detectLabel(oldClause, candidate);
        const significance = detectSignificance(oldClause, candidate);
        changes.push({
          label,
          oldText: clampText(oldClause),
          newText: clampText(candidate),
          significance,
          explanation: buildExplanation(oldClause, candidate),
        });
      }
      matched.add(bestMatch);
    }
  }

  if (changes.length === 0) {
    const firstOld = oldClauses[0];
    const firstNew = newClauses[0];
    const label = detectLabel(firstOld, firstNew);
    const significance = detectSignificance(firstOld, firstNew);
    changes.push({
      label,
      oldText: clampText(firstOld),
      newText: clampText(firstNew),
      significance,
      explanation: buildExplanation(firstOld, firstNew),
    });
  }

  const summary = changes.length === 1
    ? `${changes[0].label}: ${changes[0].newText}`
    : `${changes[0].label} changed and ${changes.length - 1} additional terms were updated.`;

  return { summary, changes: changes.slice(0, 3) };
}
