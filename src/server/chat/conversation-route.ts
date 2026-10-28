import 'server-only';

import { AppError } from '@/lib/result';

/** 대화 API 공용: JSON 본문 읽기(객체만) · no-store 응답 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('VALIDATION', '요청 본문은 JSON 이어야 합니다');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('VALIDATION', '요청 본문을 확인하세요');
  }
  return raw as Record<string, unknown>;
}

export function noStoreJson(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: { 'cache-control': 'no-store' } });
}
