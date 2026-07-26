// domain/orchestrator/evidencePack.ts
//
// The Police_Evidence_Pack generator seam (Req 8.4).
//
// PDF generation is kept behind a small injectable `EvidencePackGenerator`
// interface so the dispute/fraud orchestrator core stays pure and testable: it
// depends only on this contract, never on a concrete PDF library or Storage
// client. The default `createInMemoryEvidencePackGenerator` produces a minimal
// but well-formed PDF byte buffer and a deterministic Storage path WITHOUT any
// I/O, which is all the MVP needs; a server-only binding
// (`supabaseDisputeResolutionRepository.ts`) can wrap the same pure PDF builder
// to also upload the bytes to Supabase Storage.
//
// This module is dependency-free (no Supabase, React, or Node-only APIs beyond
// the ambient `TextEncoder`), so it is safe to import from the domain core and
// from tests.

import type { VerifiedIdentity } from '../services/types';

/**
 * The inputs to a Police_Evidence_Pack: the trade it concerns, the verified
 * identity of the offending Trader (from the KYC_Service, Req 8.4), the victim
 * Trader's id, and the time the pack was generated.
 */
export interface EvidencePackInput {
  tradeId: string;
  offendingIdentity: VerifiedIdentity;
  victimTraderId: string;
  generatedAt: string;
}

/**
 * The result of generating a Police_Evidence_Pack: the Storage path the PDF was
 * (or would be) written to, plus the raw bytes and their length. Callers persist
 * `storagePath` on the Trade (Req 8.4).
 */
export interface EvidencePackDocument {
  storagePath: string;
  bytes: Uint8Array;
  byteLength: number;
}

/**
 * The injectable seam for producing a Police_Evidence_Pack PDF (Req 8.4).
 * Implemented in-memory for the MVP/tests and by a Storage-backed binding in
 * production.
 */
export interface EvidencePackGenerator {
  generate(input: EvidencePackInput): Promise<EvidencePackDocument>;
}

/**
 * Deterministic Storage path for a Trade's evidence pack. Kept stable so a
 * regenerated pack overwrites rather than duplicates.
 */
export function evidencePackStoragePath(tradeId: string): string {
  return `evidence-packs/${tradeId}.pdf`;
}

/**
 * Escape a string for safe inclusion inside a PDF text literal `( ... )`.
 * Backslashes and the parenthesis delimiters are the characters that would
 * otherwise corrupt the content stream.
 */
function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Build a minimal, well-formed single-page PDF (v1.4) containing the evidence
 * pack fields as text lines. The cross-reference table offsets are computed from
 * the actual serialized object byte positions so the document is structurally
 * valid, not just a `%PDF` sentinel.
 *
 * This is intentionally dependency-free — no heavy PDF library — which is
 * sufficient for the MVP's Police_Evidence_Pack (Req 8.4). The real integration
 * can swap in a richer generator behind the same {@link EvidencePackGenerator}
 * interface without touching the orchestrator.
 */
export function buildEvidencePackPdf(input: EvidencePackInput): Uint8Array {
  const id = input.offendingIdentity;
  const lines: string[] = [
    'CardTrade Police Evidence Pack',
    `Trade: ${input.tradeId}`,
    `Generated: ${input.generatedAt}`,
    '',
    'Offending Trader (verified identity):',
    `  Profile: ${id.profileId}`,
    `  Legal name: ${id.legalName}`,
    `  Date of birth: ${id.dateOfBirth}`,
    `  Document: ${id.documentType} ${id.documentNumber}`,
    `  Verified at: ${id.verifiedAt}`,
    '',
    `Victim Trader: ${input.victimTraderId}`,
  ];

  // Build the page content stream: one text-showing line per entry, moved down
  // 16pt each via the TL/T* leading mechanics.
  const textOps = lines
    .map((line, index) => {
      const escaped = escapePdfText(line);
      return index === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`;
    })
    .join('\n');
  const content = `BT\n/F1 12 Tf\n16 TL\n50 760 Td\n${textOps}\nET`;

  // Assemble the five PDF objects.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = header.length + body.length;
  const count = objects.length + 1; // +1 for the free object 0
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(header + body + xref + trailer);
}

/**
 * The default in-memory {@link EvidencePackGenerator}: builds the PDF bytes via
 * {@link buildEvidencePackPdf} and returns them alongside the deterministic
 * Storage path, performing no I/O. Suitable for the MVP and for tests; a
 * server-only binding wraps the same builder to upload to Supabase Storage.
 */
export function createInMemoryEvidencePackGenerator(): EvidencePackGenerator {
  return {
    async generate(input: EvidencePackInput): Promise<EvidencePackDocument> {
      const bytes = buildEvidencePackPdf(input);
      return {
        storagePath: evidencePackStoragePath(input.tradeId),
        bytes,
        byteLength: bytes.byteLength,
      };
    },
  };
}
