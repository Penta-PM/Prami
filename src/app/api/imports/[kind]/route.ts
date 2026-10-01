import { getDbHandle } from '@/db';
import { AppError, ERROR_STATUS } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runRoute } from '@/server/auth/rbac';
import { isImportKind, KIND_DEFINITIONS } from '@/server/imports/kinds';
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_ITEM_FILES,
  MAX_ITEM_TOTAL_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  TOO_LARGE_FILE_MESSAGE,
  TOO_LARGE_ITEM_TOTAL_MESSAGE,
} from '@/lib/constants/upload-limits';
import { uploadItemFiles } from '@/server/imports/item-upload';
import { AUDIT_IMPORT_UPLOAD, uploadImport } from '@/server/imports/upload';
import { rateLimiters, retryAfterSeconds } from '@/server/rate-limit';

/** 10MB 파일 파싱·스테이징 적재 (§4.8 Vercel 함수 상한) — 로컬 측정치는 README "서버리스 제약" */
export const maxDuration = 60;

/**
 * POST /api/imports/{sales|items|costs|parts} — multipart `file` (§4.4.1, §4.7).
 * 품목조회(items)는 `files[]` 1~5개(또는 `file` 1개) → 배치 1개 (PRAMI-003 §4.2.3, 파일당 10MB·합계 25MB).
 * → { ok, data: { batchId, status, rowCount, errorCount, preview[], errors[], warnings[] } }
 * 같은 파일 재업로드는 409 + details.existingBatchId (AC-24).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
): Promise<Response> {
  const { kind } = await params;
  if (!isImportKind(kind)) {
    return Response.json(
      { ok: false, error: { code: 'NOT_FOUND', message: '알 수 없는 임포트 종류입니다' } },
      { status: ERROR_STATUS.NOT_FOUND },
    );
  }
  const guard = {
    permission: KIND_DEFINITIONS[kind].permission,
    auditAction: AUDIT_IMPORT_UPLOAD,
    target: `/api/imports/${kind}`,
  };
  return runRoute(guard, async (user) => {
    const decision = rateLimiters.imports.hit(user.id);
    if (!decision.allowed) {
      const seconds = retryAfterSeconds(decision);
      throw new AppError(
        'RATE_LIMITED',
        `업로드가 너무 잦습니다. ${seconds}초 후 다시 시도하세요`,
        undefined,
        {
          retryAfterSeconds: seconds,
        },
      );
    }
    const ctx = {
      handle: await getDbHandle(),
      actor: { id: user.id, label: user.email },
      meta: await currentRequestMeta(),
    };
    if (kind === 'items') {
      const files = await readUploadedFiles(request);
      const inputs = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      );
      return Response.json({ ok: true, data: await uploadItemFiles(ctx, inputs) }, { status: 201 });
    }
    const file = await readUploadedFile(request);
    const result = await uploadImport(ctx, {
      kind,
      fileName: file.name,
      mimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, data: result }, { status: 201 });
  });
}

/**
 * 요청 본문을 multipart 로 읽는다. 본문을 읽기 전에 Content-Length 로 크기를 확인하고(413, 상한별 문구),
 * 본문이 잘려 multipart 파싱이 실패해도 500 이 아니라 규정된 오류 봉투로 응답한다 (PR-3 QA LOW).
 * 상한 + 여유분은 proxy 본문 상한(PROXY_BODY_LIMIT_BYTES)보다 작아 proxy 가 자르기 전에 여기서 413 이 난다 (PRAMI-003 QA M-2).
 */
async function readForm(request: Request, limit: number, tooLarge: string): Promise<FormData> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit + MULTIPART_OVERHEAD_BYTES)
    throw new AppError('PAYLOAD_TOO_LARGE', tooLarge);
  try {
    return await request.formData();
  } catch {
    throw new AppError('VALIDATION', '업로드 본문을 읽을 수 없습니다. 파일을 다시 선택해 주세요');
  }
}

/** 품목조회: `files` 여러 개(또는 `file` 1개). 개수·크기 상세 검증은 uploadItemFiles 가 한다 */
async function readUploadedFiles(request: Request): Promise<File[]> {
  const form = await readForm(request, MAX_ITEM_TOTAL_BYTES, TOO_LARGE_ITEM_TOTAL_MESSAGE);
  const files = [...form.getAll('files'), ...form.getAll('file')].filter(
    (entry): entry is File => entry instanceof File,
  );
  if (files.length === 0) throw new AppError('VALIDATION', 'files 필드에 엑셀 파일을 첨부하세요');
  if (files.length > MAX_ITEM_FILES) {
    throw new AppError('VALIDATION', `품목조회 파일은 한 번에 ${MAX_ITEM_FILES}개까지입니다`);
  }
  return files;
}

async function readUploadedFile(request: Request): Promise<File> {
  const form = await readForm(request, MAX_IMPORT_FILE_BYTES, TOO_LARGE_FILE_MESSAGE);
  const file = form.get('file');
  if (!(file instanceof File))
    throw new AppError('VALIDATION', 'file 필드에 엑셀 파일을 첨부하세요');
  if (file.size > MAX_IMPORT_FILE_BYTES)
    throw new AppError('PAYLOAD_TOO_LARGE', TOO_LARGE_FILE_MESSAGE);
  return file;
}
