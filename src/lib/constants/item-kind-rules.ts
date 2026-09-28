/**
 * 품목 종류(본품/파츠/결합형/서비스) 임시 판정 규칙 — **품목 마스터(품목조회 파일) 도착 전까지만** 쓴다.
 * 마스터가 `item_kind` 를 주면 서버 SQL(`server/parts/catalog.ts` ITEM_KIND_SQL)이 그것을 우선하므로,
 * 마스터가 확정되면 이 파일과 SQL 의 품명 규칙 분기를 함께 제거한다 (PR-6 QA LOW-1).
 *
 * PostgreSQL 정규식(대소문자 무시 `~*`)과 JS 정규식이 같은 패턴을 쓰도록 문자열로 둔다.
 */

/** 파츠: ERP 파츠 코드(N_xxxxx / N-xxxxx, 품명 어디서든) + 저장장치·메모리·NIC·GBIC·가속카드 */
export const PART_NAME_PATTERN =
  '(N[_-][0-9]{3,}|\\mSSD\\M|\\mHDD\\M|\\mNVMe\\M|Memory|\\mRAM\\M|\\mDDR[0-9]|\\mNIC\\M|GBIC|\\mSFP\\M|가속카드|랜카드|포트\\s*카드)';

/** 서비스: 기술지원·유지보수·구축/장애/점검 서비스·인력(M/D, M/M)·운송비 */
export const SERVICE_NAME_PATTERN =
  '(기술지원|유지보수|지원\\s*서비스|점검\\s*서비스|서비스\\s*Full|보안정책설정|구축지원|장애지원|\\mM/[DM]\\M|인력|Delivery\\s*Fee|교육)';

const toJs = (pattern: string) =>
  new RegExp(pattern.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), 'i');

export const PART_NAME_REGEX = toJs(PART_NAME_PATTERN);
export const SERVICE_NAME_REGEX = toJs(SERVICE_NAME_PATTERN);

export type ItemKindFallback = '본품' | '파츠' | '서비스';

/** JS 쪽 동일 판정 (테스트·클라이언트 표시용). 마스터 값이 있으면 호출하지 않는다 */
export function classifyItemName(itemName: string): ItemKindFallback {
  if (PART_NAME_REGEX.test(itemName)) return '파츠';
  if (SERVICE_NAME_REGEX.test(itemName)) return '서비스';
  return '본품';
}
