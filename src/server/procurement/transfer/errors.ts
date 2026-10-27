/**
 * 이관·검증 오류를 값 없이 출력한다 (DB-3 — 금액·이름 등 원본 값이 로그에 남지 않게).
 * Drizzle 의 "Failed query: <SQL> params: <값들>" 은 버리고, 원인 체인의 DB 오류 메시지·코드만 남기며 따옴표 안 값은 가린다.
 */
export function safeErrorMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const message = String((current as Error).message ?? current);
    const code = (current as { code?: unknown }).code;
    if (!message.startsWith('Failed query:')) {
      const redacted = message
        .split('\n')[0]!
        .replace(/"[^"]*"/g, '"…"')
        .replace(/'[^']*'/g, "'…'");
      parts.push(typeof code === 'string' ? `${redacted} [${code}]` : redacted);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' ← ') || '알 수 없는 오류';
}
