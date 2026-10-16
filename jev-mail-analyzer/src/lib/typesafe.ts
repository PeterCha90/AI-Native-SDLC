import {
  TypeSafeClient,
  APIError,
  RateLimitError,
  AuthenticationError,
  APIConnectionError,
  APITimeoutError,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { MODEL } from "./questions";

/**
 * The SDK normally reads TYPESAFE_API_KEY, but this project's .env uses
 * TYPESAFE_AI_API_KEY — read that first and fall back for compatibility.
 */
function resolveApiKey(): string {
  const key = process.env.TYPESAFE_AI_API_KEY ?? process.env.TYPESAFE_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "TYPESAFE_AI_API_KEY가 설정되어 있지 않습니다. .env 파일에 TypeSafe AI API 키를 추가하세요.",
    );
  }
  return key;
}

let client: TypeSafeClient | undefined;

/** Lazily-created singleton client, so a missing key only fails on first use. */
export function getClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient({
      apiKey: resolveApiKey(),
      defaultModel: MODEL,
      timeout: 20000,
    });
  }
  return client;
}

/** Maps SDK error classes to short, Korean, UI-facing messages. */
export function describeError(err: unknown): string {
  if (err instanceof RateLimitError) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도하세요. (rate limit)";
  }
  if (err instanceof AuthenticationError) {
    return "TypeSafe AI 인증에 실패했습니다. API 키를 확인하세요.";
  }
  if (err instanceof APITimeoutError) {
    return "TypeSafe AI 응답이 시간 초과되었습니다.";
  }
  if (err instanceof APIConnectionError) {
    return "TypeSafe AI에 연결할 수 없습니다. 네트워크를 확인하세요.";
  }
  if (err instanceof APIError) {
    return `TypeSafe AI 오류 (HTTP ${err.status}): ${err.message}`;
  }
  if (err instanceof TypeSafeError) {
    return `TypeSafe AI 오류: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "알 수 없는 오류가 발생했습니다.";
}
