/**
 * xlsx(zip) 사전 검사 — 파서에 넘기기 전에 구조만 읽어 위험한 입력을 명확한 오류로 거절한다 (PR-3 QA).
 * - EOCD(End of Central Directory) 뒤에 바이트가 붙은 파일: read-excel-file 이 settle 하지 않아 요청이 멈춘다 → 거절
 * - 압축 해제 크기 합계 상한 (zip bomb): 중앙 디렉터리의 uncompressed size 합으로 판단
 * - ZIP64·손상된 디렉터리는 지원하지 않는다
 */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const ZIP64_MARKER = 0xffffffff;

/** 압축 해제 크기 합계 상한. 원본 5,885행 xlsx 는 약 3MB 이므로 넉넉한 값 */
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

export class ZipGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipGuardError';
  }
}

function findEocd(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

export type ZipSummary = { entries: number; uncompressedBytes: number };

/** 구조 검사 결과를 돌려주거나 ZipGuardError 를 던진다 */
export function inspectZip(buffer: Buffer, maxUncompressed = MAX_UNCOMPRESSED_BYTES): ZipSummary {
  if (buffer.length < EOCD_MIN_SIZE) throw new ZipGuardError('엑셀(.xlsx) 파일이 아닙니다');
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new ZipGuardError('엑셀(.xlsx) 파일이 아니거나 손상되었습니다');
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (eocd + EOCD_MIN_SIZE + commentLength !== buffer.length) {
    throw new ZipGuardError(
      '파일 끝에 엑셀 형식이 아닌 데이터가 붙어 있습니다. 원본 파일을 다시 저장해 올려 주세요',
    );
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (directoryOffset === ZIP64_MARKER || directorySize === ZIP64_MARKER || entries === 0xffff) {
    throw new ZipGuardError('지원하지 않는 형식(ZIP64)입니다');
  }
  if (directoryOffset + directorySize > eocd) throw new ZipGuardError('엑셀 파일이 손상되었습니다');

  let offset = directoryOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + CENTRAL_HEADER_SIZE > eocd || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipGuardError('엑셀 파일이 손상되었습니다');
    }
    const size = buffer.readUInt32LE(offset + 24);
    if (size === ZIP64_MARKER) throw new ZipGuardError('지원하지 않는 형식(ZIP64)입니다');
    uncompressedBytes += size;
    if (uncompressedBytes > maxUncompressed) {
      throw new ZipGuardError(
        `압축을 푼 크기가 너무 큽니다 (상한 ${Math.round(maxUncompressed / 1024 / 1024)}MB)`,
      );
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    offset += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLen;
  }
  return { entries, uncompressedBytes };
}
