import { sql } from 'drizzle-orm';

import { queryRows, type Executor } from '@/server/imports/sql-rows';

/**
 * 파츠 매핑 초안 (PRAMI-003 §4.9.5, AC-336). 현재 DB 의 master 품목만 읽어(원본 파일을 다시 읽지 않음) 규격 기반 후보 쌍을 만든다.
 * DB 에 쓰지 않는다 — 관리자가 초안을 검수한 뒤 `/admin/parts` 엑셀 등록으로 넣는다.
 *
 * 규칙(§4.9.5):
 * ① 파츠 = 종류 '파츠' ∧ 상태 '사용', 모델 = 종류 '본품' ∧ 상태 '사용' ∧ 품명에 플랫폼 번호 토큰이 있음
 * ② 같은 대분류 안에서만 연결
 * ③ 파츠 규격에서 `(\d{3,5})(T\d)?` 토큰을 뽑아 모델 품명의 플랫폼 번호와 같으면 연결
 * ④ 규격 토큰에 T1/T2 가 붙으면 모델 품명의 T 표기까지 같아야 하고, 없으면 T1·T2·표기 없음 모두
 * ⑤ 규격이 `<품번 또는 파츠명> 대체카드` 면 참조 파츠의 규격을 이어받는다
 * ⑥ 토큰이 안 나오는 파츠는 "근거 없음"(일치하는 모델이 없는 파츠도 사유와 함께 같은 목록)
 * 결과는 결정적이다(정렬 고정).
 */
export type DraftItem = {
  itemCode: string;
  itemName: string;
  categoryMajor: string;
  itemKind: string;
  itemStatus: string;
  spec: string | null;
};

export type PlatformToken = { number: string; tier: string | null };

export type DraftPair = {
  major: string;
  modelCode: string;
  modelName: string;
  partCode: string;
  partName: string;
  specRaw: string;
  rule: string;
};

export type NoEvidencePart = {
  major: string;
  partCode: string;
  partName: string;
  specRaw: string;
  reason: '규격 토큰 없음' | '일치 모델 없음' | '대체카드 참조 없음';
};

export type PartsDraft = {
  pairs: DraftPair[];
  noEvidence: NoEvidencePart[];
  perMajor: Record<string, number>;
};

const SPEC_TOKEN_RE = /(?<!\d)(\d{3,5})(T\d)?(?!\d)/g;
/** 모델 품명: 천 단위 쉼표 숫자(1,000)는 플랫폼 번호가 아니다. `1700 T1`·`1700T1` 둘 다 T 표기로 본다 */
const MODEL_TOKEN_RE = /(?<![\d,])(\d{3,5})(?![\d,])(?:\s?(T\d)(?![\dA-Za-z]))?/g;
const REPLACEMENT_RE = /^\s*(.+?)\s*대체카드\s*$/;

export function specTokens(spec: string | null): PlatformToken[] {
  if (!spec) return [];
  return [...spec.matchAll(SPEC_TOKEN_RE)].map((m) => ({ number: m[1]!, tier: m[2] ?? null }));
}

export function modelTokens(name: string): PlatformToken[] {
  return [...name.matchAll(MODEL_TOKEN_RE)].map((m) => ({ number: m[1]!, tier: m[2] ?? null }));
}

/** ③·④: 규격 토큰 하나가 모델 토큰 하나와 맞는지 */
export function tokenMatches(part: PlatformToken, model: PlatformToken): boolean {
  if (part.number !== model.number) return false;
  return part.tier === null || part.tier === model.tier;
}

const firstWord = (name: string) => name.trim().split(/[\s(-]/)[0] ?? '';

/** ⑤ 대체카드 참조 해석 — 같은 대분류의 파츠에서 품번 또는 품명 첫 단어가 같은 것 (품번 순 첫 번째) */
function resolveSpec(
  part: DraftItem,
  partsInMajor: readonly DraftItem[],
): { spec: string | null; via: string | null; unresolved: boolean } {
  const match = REPLACEMENT_RE.exec(part.spec ?? '');
  if (!match) return { spec: part.spec, via: null, unresolved: false };
  const ref = match[1]!;
  const target = partsInMajor.find(
    (candidate) =>
      candidate.itemCode !== part.itemCode &&
      (candidate.itemCode === ref || firstWord(candidate.itemName) === ref) &&
      !REPLACEMENT_RE.test(candidate.spec ?? ''),
  );
  return target
    ? { spec: target.spec, via: ref, unresolved: false }
    : { spec: null, via: ref, unresolved: true };
}

const byCode = (a: DraftItem, b: DraftItem) => a.itemCode.localeCompare(b.itemCode);
const label = (token: PlatformToken) => `${token.number}${token.tier ?? ''}`;

export function buildPartsDraft(items: readonly DraftItem[]): PartsDraft {
  const active = (kind: string) =>
    items.filter((item) => item.itemKind === kind && item.itemStatus === '사용').sort(byCode);
  const models = active('본품').filter((item) => modelTokens(item.itemName).length > 0);
  const parts = active('파츠');
  const allParts = items.filter((item) => item.itemKind === '파츠').sort(byCode);
  const pairs: DraftPair[] = [];
  const noEvidence: NoEvidencePart[] = [];

  for (const part of parts) {
    const resolved = resolveSpec(
      part,
      allParts.filter((p) => p.categoryMajor === part.categoryMajor),
    );
    const tokens = specTokens(resolved.spec);
    const base = {
      major: part.categoryMajor,
      partCode: part.itemCode,
      partName: part.itemName,
      specRaw: part.spec ?? '',
    };
    if (tokens.length === 0) {
      noEvidence.push({
        ...base,
        reason: resolved.unresolved ? '대체카드 참조 없음' : '규격 토큰 없음',
      });
      continue;
    }
    let matched = 0;
    for (const model of models.filter((m) => m.categoryMajor === part.categoryMajor)) {
      const hit = tokens.find((token) =>
        modelTokens(model.itemName).some((modelToken) => tokenMatches(token, modelToken)),
      );
      if (!hit) continue;
      matched += 1;
      const via = resolved.via ? `대체카드 상속(${resolved.via}) · ` : '';
      pairs.push({
        ...base,
        modelCode: model.itemCode,
        modelName: model.itemName,
        rule: `${via}규격 토큰 ${label(hit)}${hit.tier ? '(T 일치)' : ''}`,
      });
    }
    if (matched === 0) noEvidence.push({ ...base, reason: '일치 모델 없음' });
  }

  pairs.sort(
    (a, b) =>
      a.major.localeCompare(b.major) ||
      a.modelCode.localeCompare(b.modelCode) ||
      a.partCode.localeCompare(b.partCode),
  );
  noEvidence.sort((a, b) => a.major.localeCompare(b.major) || a.partCode.localeCompare(b.partCode));
  const perMajor: Record<string, number> = {};
  for (const pair of pairs) perMajor[pair.major] = (perMajor[pair.major] ?? 0) + 1;
  return { pairs, noEvidence, perMajor };
}

/** master 품목 중 본품·파츠만 (규격은 raw 의 `규격` 원문) */
export async function loadDraftItems(db: Executor): Promise<DraftItem[]> {
  const rows = await queryRows<{
    item_code: string;
    item_name: string;
    category_major: string;
    item_kind: string;
    item_status: string;
    spec: string | null;
  }>(
    db,
    sql`select item_code, item_name, category_major, item_kind::text as item_kind,
          item_status::text as item_status, raw->>'규격' as spec
        from items where source = 'master' and item_kind in ('본품', '파츠')
        order by item_code`,
  );
  return rows.map((row) => ({
    itemCode: row.item_code,
    itemName: row.item_name,
    categoryMajor: row.category_major,
    itemKind: row.item_kind,
    itemStatus: row.item_status,
    spec: row.spec,
  }));
}

/** xlsx 3시트 내용 — 시트 1 은 `/admin/parts` 엑셀 등록 형식 2컬럼(모델품번·파츠품번), 시트 2 검수용, 시트 3 근거 없음 */
export function draftSheets(draft: PartsDraft) {
  return {
    mapping: [['모델품번', '파츠품번'], ...draft.pairs.map((p) => [p.modelCode, p.partCode])],
    review: [
      ['대분류', '모델 품번', '모델 품명', '파츠 품번', '파츠 품명', '파츠 규격 원문', '적용 규칙'],
      ...draft.pairs.map((p) => [
        p.major,
        p.modelCode,
        p.modelName,
        p.partCode,
        p.partName,
        p.specRaw,
        p.rule,
      ]),
    ],
    noEvidence: [
      ['대분류', '파츠 품번', '파츠 품명', '파츠 규격 원문', '사유'],
      ...draft.noEvidence.map((p) => [p.major, p.partCode, p.partName, p.specRaw, p.reason]),
    ],
  };
}
