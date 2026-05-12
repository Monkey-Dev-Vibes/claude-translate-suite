/**
 * Claude API call wrapper.
 *
 * One shape for both translator and reviewer passes: compose system + user,
 * run inside `withRetry`, flatten content blocks into a flat string, throw
 * `PipelineParseError` on empty content, return raw + token usage.
 *
 * Auto-streams when `maxTokens >= STREAMING_MIN_TOKENS` (16k). The Anthropic
 * SDK enforces a 10-minute non-streaming timeout; above that token budget
 * the call needs to stream or it can be aborted at the SDK timeout boundary.
 *
 * The model ID is always caller-supplied — this package deliberately ships
 * no default. Pinning a model is the caller's responsibility so silent model
 * upgrades cannot regress their output.
 */

import Anthropic from '@anthropic-ai/sdk';

import { PipelineParseError } from './parse.js';
import { withRetry } from './retry.js';

/** Streaming cut-over threshold. Exported so adapters can match it. */
export const STREAMING_MIN_TOKENS = 16000;

export interface ClaudeCallParams {
  client: Anthropic;
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  /** Label shown in error messages (e.g. "Translator", "Reviewer"). */
  role: string;
}

export interface ClaudeCallResult {
  raw: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

/** One Claude API call with retry on transient failures. */
export async function callClaude(params: ClaudeCallParams): Promise<ClaudeCallResult> {
  const { client, model, maxTokens, system, user, role } = params;

  if (maxTokens >= STREAMING_MIN_TOKENS) {
    return callClaudeStreaming(params);
  }

  const response = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  );

  // The SDK's ContentBlock union has shifted across versions (TextBlock,
  // ThinkingBlock, ToolUseBlock, …). Narrow structurally on `type === 'text'`
  // instead of importing a versioned namespaced type.
  const raw = response.content
    .filter(
      (c): c is Extract<(typeof response.content)[number], { type: 'text' }> =>
        c.type === 'text',
    )
    .map((c) => c.text)
    .join('');

  if (!raw) {
    throw new PipelineParseError(
      `${role} response had no text content`,
      JSON.stringify(response),
    );
  }

  return {
    raw,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  };
}

async function callClaudeStreaming(params: ClaudeCallParams): Promise<ClaudeCallResult> {
  const { client, model, maxTokens, system, user, role } = params;

  return withRetry(async () => {
    let raw = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        typeof event.delta.text === 'string'
      ) {
        raw += event.delta.text;
      } else if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens;
      } else if (event.type === 'message_start' && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens;
      }
    }

    if (!raw) {
      throw new PipelineParseError(
        `${role} streaming response had no text content`,
        '',
      );
    }

    return { raw, inputTokens, outputTokens };
  });
}

/**
 * Make a Claude call AND parse the response inside the same retry envelope.
 *
 * `callClaude` retries transient API failures (429, 5xx, sockets), but a
 * malformed JSON response slips past it because the parse runs after the
 * call returns. With this wrapper, a `PipelineParseError` thrown by the
 * parser triggers one more API+parse attempt — covering the truncated-output
 * case where the model drops a closing brace.
 */
export async function callClaudeWithParser<T>(
  params: ClaudeCallParams,
  parser: (raw: string) => T,
): Promise<{ parsed: T } & ClaudeCallResult> {
  return withRetry(async () => {
    const result = await callClaude(params);
    const parsed = parser(result.raw);
    return { parsed, ...result };
  });
}
