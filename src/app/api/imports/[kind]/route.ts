import { getDbHandle } from '@/db';
import { AppError, ERROR_STATUS } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runRoute } from '@/server/auth/rbac';
import { isImportKind, KIND_DEFINITIONS } from '@/server/imports/kinds';
import { MAX_IMPORT_FILE_BYTES } from '@/server/imports/parse-xlsx';
import { AUDIT_IMPORT_UPLOAD, uploadImport } from '@/server/imports/upload';

/**
 * POST /api/imports/{sales|items|costs|parts} — multipart `file` (§4.4.1, §4.7).
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
    const file = (await request.formData()).get('file');
    if (!(file instanceof File))
      throw new AppError('VALIDATION', 'file 필드에 엑셀 파일을 첨부하세요');
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new AppError('VALIDATION', '파일은 10MB 이하만 업로드할 수 있습니다');
    }
    const result = await uploadImport(
      {
        handle: await getDbHandle(),
        actor: { id: user.id, label: user.email },
        meta: await currentRequestMeta(),
      },
      {
        kind,
        fileName: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      },
    );
    return Response.json({ ok: true, data: result }, { status: 201 });
  });
}
