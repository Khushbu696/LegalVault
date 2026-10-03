import { describe, expect, it } from "vitest";
import { locateQuoteOccurrence } from "@/lib/documents/citation";
import { compareContracts } from "@/lib/documents/comparison";
import { buildMultiDocumentExcerpt } from "@/lib/ai/multi-document-context";

describe("multi-document context recovery", () => {
  it("retrieves excerpts from canonical text when a ready document has no stored chunks", () => {
    const document = {
      id: "doc-a",
      extractedText: "Services Agreement\n\nThe Contractor shall deliver the services described in Exhibit A.\n\nThe Client shall pay each invoice within thirty (30) days of receipt.",
      pageRanges: [],
    };

    const excerpt = buildMultiDocumentExcerpt("What services and payment terms are in this contract?", document, []);

    expect(excerpt).toContain("deliver the services described in Exhibit A");
    expect(excerpt).toContain("pay each invoice within thirty (30) days");
  });
});

describe("citation mapping", () => {
  it("prefers the occurrence that matches the provided context instead of always taking the first match", () => {
    const text = [
      "Section 5. Payment Terms",
      "The Client shall pay each invoice within thirty (30) days.",
      "",
      "Section 7. Payment Terms",
      "The Client shall pay each invoice within thirty (30) days.",
    ].join("\n");

    const match = locateQuoteOccurrence(
      text,
      "The Client shall pay each invoice within thirty (30) days.",
      [
        { page: 1, start: 0, end: Math.floor(text.length / 2) },
        { page: 2, start: Math.floor(text.length / 2), end: text.length },
      ],
      { contextText: "Section 7. Payment Terms" },
    );

    expect(match).not.toBeNull();
    expect(match?.pageStart).toBe(2);
    expect(match?.matchedText).toContain("The Client shall pay each invoice within thirty (30) days.");
  });
});

describe("contract comparison", () => {
  it("summarizes a materially meaningful payment-term change at clause level", () => {
    const summary = compareContracts(
      "The Client shall pay each invoice within 30 days of receipt.",
      "The Client shall pay each invoice within 45 days of receipt.",
    );

    expect(summary.changes.length).toBeGreaterThan(0);
    expect(summary.summary.toLowerCase()).toContain("45");
    expect(summary.changes[0]?.label.toLowerCase()).toMatch(/payment|term/i);
    expect(summary.changes[0]?.significance.toLowerCase()).toMatch(/medium|high/i);
  });

  it("aligns numbered clauses by section and excludes unchanged clauses from changes", () => {
    const versionA = [
      "1. Parties\nNorthstar and Client enter this agreement.",
      "2. Services\nThe service includes search.",
      "3. Term\nThe agreement runs for 12 months.",
      "4. Fees and Payment\nTotal fee is ₹600,000, payable in four equal instalments. Invoices are due within 30 days.",
      "5. Confidentiality\nEach party must protect confidential information.",
      "6. Intellectual Property\nAll project work belongs to Northstar.",
      "7. Liability\nLiability is capped at the total fees paid under the agreement.",
      "8. Termination\nEither party may terminate on 60 days' notice.",
      "9. Governing Law\nThe laws of India govern this agreement.",
    ].join("\n\n");
    const versionB = [
      "1. Parties\nNorthstar and Client enter this agreement.",
      "2. Services\nThe service includes semantic search.",
      "3. Term\nThe agreement runs for 18 months.",
      "4. Fees and Payment\nTotal fee is ₹750,000, payable in three equal instalments. Invoices are due within 15 days.",
      "5. Confidentiality\nEach party must protect confidential information.",
      "6. Intellectual Property\nAll project work belongs to Northstar.",
      "7. Liability\nLiability is capped at ₹2,000,000.",
      "8. Termination\nEither party may terminate on 30 days' notice.",
      "9. Governing Law\nThe laws of India govern this agreement.",
    ].join("\n\n");

    const comparison = compareContracts(versionA, versionB);
    const section4 = comparison.alignments.find((alignment) => alignment.sectionNumber === "4");
    const section6 = comparison.alignments.find((alignment) => alignment.sectionNumber === "6");

    expect(section4).toMatchObject({ oldHeading: "Fees and Payment", newHeading: "Fees and Payment", matchType: "number", status: "materially-changed" });
    expect(section6).toMatchObject({ oldHeading: "Intellectual Property", newHeading: "Intellectual Property", matchType: "number", status: "unchanged" });
    expect(comparison.changes.some((change) => change.label === "Intellectual Property")).toBe(false);
    expect(comparison.changes.map((change) => change.label)).toEqual(expect.arrayContaining(["Services", "Term", "Fees and Payment", "Liability", "Termination"]));
    expect(comparison.changes.map((change) => change.label)).not.toEqual(expect.arrayContaining(["Parties", "Confidentiality", "Governing Law"]));
    expect(comparison.changes.find((change) => change.label === "Fees and Payment")?.explanation).toContain("600,000");
    expect(comparison.changes.find((change) => change.label === "Fees and Payment")?.explanation).toContain("750,000");
    expect(comparison.changes.find((change) => change.label === "Fees and Payment")?.explanation).not.toContain("600,000,");
    expect(comparison.changes.find((change) => change.label === "Fees and Payment")?.explanation).toContain("30 days");
    expect(comparison.changes.find((change) => change.label === "Fees and Payment")?.explanation).toContain("15 days");
  });

  it("does not pair unrelated numbered clauses or fabricate a change for identical agreements", () => {
    const versionA = "4. Fees and Payment\nThe fee is ₹600,000.\n\n6. Intellectual Property\nThe Client owns the deliverables.";
    const unrelatedVersionB = "2. Services\nThe initial scope includes document upload, text extraction, semantic search, and reporting.\n\n4. Intellectual Property\nThe Client owns the deliverables.";
    const unrelated = compareContracts(versionA, unrelatedVersionB);

    expect(unrelated.alignments.find((alignment) => alignment.oldHeading === "Fees and Payment")?.matchType).toBe("removed");
    expect(unrelated.alignments.find((alignment) => alignment.newHeading === "Services")?.matchType).toBe("added");
    expect(unrelated.alignments.find((alignment) => alignment.oldHeading === "Intellectual Property")?.newHeading).toBe("Intellectual Property");

    const identical = compareContracts(versionA, versionA);
    expect(identical.changes).toEqual([]);
    expect(identical.alignments.every((alignment) => alignment.status === "unchanged")).toBe(true);
  });

  it("compares written durations with parenthetical numerals without confusing them with other amounts", () => {
    const comparison = compareContracts(
      "4. Fees and Payment\nThe total fee is n600,000. Invoices are due within thirty (30)\n days of receipt.",
      "4. Fees and Payment\nThe total fee is n750,000. Invoices are due within 15 days of receipt.",
    );
    const paymentChange = comparison.changes[0];

    expect(paymentChange?.explanation).toContain("600,000");
    expect(paymentChange?.explanation).toContain("750,000");
    expect(paymentChange?.explanation).toContain("thirty (30) days");
    expect(paymentChange?.explanation).toContain("15 days");
    expect(paymentChange?.explanation).not.toContain("from 600000 to 3");
  });

  it("uses unnumbered headings instead of paragraph order when section numbers are absent", () => {
    const versionA = "Parties\nThe same two parties contract.\n\nFees and Payment\nThe total fee is 600,000.\n\nIntellectual Property\nThe Client owns the deliverables.";
    const versionB = "Intellectual Property\nThe Client owns the deliverables.\n\nFees and Payment\nThe total fee is 750,000.\n\nParties\nThe same two parties contract.";
    const comparison = compareContracts(versionA, versionB);
    const feeAlignment = comparison.alignments.find((alignment) => alignment.oldHeading === "Fees and Payment");

    expect(feeAlignment).toMatchObject({ newHeading: "Fees and Payment", matchType: "heading", status: "materially-changed" });
    expect(comparison.changes).toHaveLength(1);
    expect(comparison.changes[0]?.label).toBe("Fees and Payment");
  });
});
