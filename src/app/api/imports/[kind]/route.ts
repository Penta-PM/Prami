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
    const file = await readUploadedFile(request);
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

const TOO_LARGE = '파일은 10MB 이하만 업로드할 수 있습니다';
/** multipart 경계·헤더 여유분 */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * 요청 본문에서 file 을 꺼낸다. 본문을 읽기 전에 Content-Length 로 크기를 확인하고(413),
 * 본문이 잘려 multipart 파싱이 실패해도 500 이 아니라 규정된 오류 봉투로 응답한다 (PR-3 QA LOW).
 */
async function readUploadedFile(request: Request): Promise<File> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_IMPORT_FILE_BYTES + MULTIPART_OVERHEAD) {
    throw new AppError('PAYLOAD_TOO_LARGE', TOO_LARGE);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError('VALIDATION', '업로드 본문을 읽을 수 없습니다. 파일을 다시 선택해 주세요');
  }
  const file = form.get('file');
  if (!(file instanceof File))
    throw new AppError('VALIDATION', 'file 필드에 엑셀 파일을 첨부하세요');
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', TOO_LARGE);
  return file;
}
