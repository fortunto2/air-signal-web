import type { APIRoute } from "astro";
import { answerAbout } from "../lib/answer-about";
import { SITE, abs } from "../lib/site";

/**
 * The A2A endpoint. JSON-RPC 2.0 over POST, one method.
 *
 * This exists before the agent card that advertises it, and in that order on purpose: a card
 * pointing at an endpoint that does not answer is worse than no card, because it converts a site
 * that an agent would have scraped successfully into one that fails halfway through a protocol.
 *
 * The skill is deliberately narrow — one question, asked in words, answered with the numbers and a
 * link. An agent that wants structure should use the OpenAPI document; this is for the case where
 * the caller has a sentence and no idea what our endpoints are.
 *
 * No authentication. The data is open, every answer is public, and there is nothing here that a
 * credential would protect.
 */

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    message?: { role?: string; parts?: { kind?: string; text?: string }[] };
  };
}

const ok = (id: string | number | null | undefined, result: unknown) =>
  json({ jsonrpc: "2.0", id: id ?? null, result });

const fail = (id: string | number | null | undefined, code: number, message: string) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

export const OPTIONS: APIRoute = () =>
  new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });

export const POST: APIRoute = async ({ request }) => {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return fail(null, -32700, "Parse error");
  }

  if (body.method !== "message/send") {
    return fail(body.id, -32601, `Unknown method ${body.method ?? "(none)"} — only message/send`);
  }

  const text = (body.params?.message?.parts ?? [])
    .filter((p) => p.kind === "text" || p.text !== undefined)
    .map((p) => p.text ?? "")
    .join(" ")
    .trim();

  if (!text) return fail(body.id, -32602, "No text part in the message");

  const answer = await answerAbout(text);

  return ok(body.id, {
    kind: "message",
    role: "agent",
    messageId: crypto.randomUUID(),
    parts: [
      { kind: "text", text: answer.text },
      // The same answer as data, so a caller does not have to parse the sentence it just asked for.
      { kind: "data", data: answer.data },
    ],
  });
};

/** A GET is almost always a human or a confused crawler. Point them at the card. */
export const GET: APIRoute = () =>
  json({
    error: "A2A speaks JSON-RPC 2.0 over POST",
    method: "message/send",
    agentCard: abs("/.well-known/agent-card.json"),
    openapi: abs("/openapi.json"),
    site: SITE.origin,
  }, 405);
