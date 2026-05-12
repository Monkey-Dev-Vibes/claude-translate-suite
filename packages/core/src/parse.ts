/**
 * Claude-response parsing primitives.
 *
 * The translator returns JSON of a pipeline-defined shape; the reviewer
 * returns a structured verdict envelope. This module handles:
 *
 *   - Stripping accidental markdown code fences.
 *   - Safe JSON.parse with a structured error class.
 *   - Generic reviewer-response parser (works for any pipeline whose issues
 *     reference a "location" — field name, JSON pointer, etc.).
 *   - Verdict reconciliation (trust the issues list over the verdict label).
 */

/** Thrown when a Claude response cannot be parsed as the expected JSON shape. */
export class PipelineParseError extends Error {
  public readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = 'PipelineParseError';
    this.raw = raw;
  }
}

/** Strip a markdown code fence from a payload if one is present. */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced && fenced[1] ? fenced[1].trim() : trimmed;
}

/** `JSON.parse` plus code-fence stripping; throws `PipelineParseError` on failure. */
export function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch (err) {
    throw new PipelineParseError(
      `Failed to parse JSON: ${(err as Error).message}`,
      raw,
    );
  }
}

export type Severity = 'critical' | 'major' | 'minor';
export type Verdict = 'approved' | 'needs-human' | 'rejected';

/** One reviewer-flagged issue. `locationKey` lets callers serialise back. */
export interface ParsedIssue<LocationKey extends string = string> {
  severity: Severity;
  description: string;
  suggestion?: string;
  /** The value at the location property (e.g. the field name or key path). */
  location?: string;
  /** Which property in the raw issue object held the location (e.g. `"field"`). */
  locationKey: LocationKey;
}

export interface ParsedReviewerResponse<LocationKey extends string = string> {
  verdict: Verdict;
  /** 0–100, integer (rounded on parse). */
  confidence: number;
  issues: ParsedIssue<LocationKey>[];
  notes: string;
}

const VALID_SEVERITIES: Severity[] = ['critical', 'major', 'minor'];
const VALID_VERDICTS: Verdict[] = ['approved', 'needs-human', 'rejected'];

/**
 * Parse a reviewer response. The reviewer is expected to return JSON of shape:
 *
 *     {
 *       "verdict": "approved" | "needs-human" | "rejected",
 *       "confidence": 0-100,
 *       "issues": [
 *         { "severity": "critical" | "major" | "minor",
 *           "description": "...",
 *           "suggestion": "...",
 *           "<locationKey>": "..." }
 *       ],
 *       "notes": "..."
 *     }
 *
 * `locationKey` tells the parser which property holds the issue location —
 * typically `"field"` for CMS documents or `"key"` for locale JSON files.
 */
export function parseReviewerResponse<LocationKey extends string>(
  raw: string,
  locationKey: LocationKey,
): ParsedReviewerResponse<LocationKey> {
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PipelineParseError('Reviewer response is not a JSON object', raw);
  }
  const obj = parsed as Record<string, unknown>;

  const verdict = obj['verdict'];
  if (typeof verdict !== 'string' || !VALID_VERDICTS.includes(verdict as Verdict)) {
    throw new PipelineParseError(
      `Reviewer verdict must be one of ${VALID_VERDICTS.join(', ')}, got: ${String(verdict)}`,
      raw,
    );
  }

  const confidence = obj['confidence'];
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 100) {
    throw new PipelineParseError(
      `Reviewer confidence must be a number 0-100, got: ${String(confidence)}`,
      raw,
    );
  }

  const issuesRaw = obj['issues'] ?? [];
  if (!Array.isArray(issuesRaw)) {
    throw new PipelineParseError('Reviewer "issues" must be an array', raw);
  }

  const issues: ParsedIssue<LocationKey>[] = issuesRaw.map((rawIssue, idx) => {
    if (!rawIssue || typeof rawIssue !== 'object') {
      throw new PipelineParseError(`Issue ${idx} is not an object`, raw);
    }
    const i = rawIssue as Record<string, unknown>;
    if (
      typeof i['severity'] !== 'string' ||
      !VALID_SEVERITIES.includes(i['severity'] as Severity)
    ) {
      throw new PipelineParseError(
        `Issue ${idx} severity must be one of ${VALID_SEVERITIES.join(', ')}, got: ${String(i['severity'])}`,
        raw,
      );
    }
    if (typeof i['description'] !== 'string' || !i['description'].trim()) {
      throw new PipelineParseError(`Issue ${idx} missing description`, raw);
    }
    const locationValue = i[locationKey];
    return {
      severity: i['severity'] as Severity,
      description: i['description'],
      suggestion: typeof i['suggestion'] === 'string' ? i['suggestion'] : undefined,
      location: typeof locationValue === 'string' ? locationValue : undefined,
      locationKey,
    };
  });

  const notes = typeof obj['notes'] === 'string' ? obj['notes'] : '';

  return {
    verdict: verdict as Verdict,
    confidence: Math.round(confidence),
    issues,
    notes,
  };
}

/**
 * Reconcile the declared verdict with the actual issue severities. Catches
 * the case where the model declares "approved" but lists a critical issue.
 *
 * Rules:
 *   - any critical issue  → `rejected`
 *   - any major issue OR confidence < 70 → `needs-human`
 *   - otherwise → `approved`
 */
export function reconcileVerdict<
  T extends {
    confidence: number;
    issues: ReadonlyArray<{ severity: Severity }>;
  },
>(review: T): Verdict {
  const hasCritical = review.issues.some((i) => i.severity === 'critical');
  const hasMajor = review.issues.some((i) => i.severity === 'major');
  if (hasCritical) return 'rejected';
  if (hasMajor || review.confidence < 70) return 'needs-human';
  return 'approved';
}
