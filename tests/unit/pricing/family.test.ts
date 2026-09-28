// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { filterToQuery, parsePriceFilter } from '@/features/pricing/filter';
import {
  productCardHref,
  productFamilyMajors,
  PRODUCT_CARDS,
  PRODUCT_FAMILY_MAJORS,
} from '@/lib/constants/product-cards';
import { applyPolicy } from '@/server/imports/apply-policy';
import { getPriceRows } from '@/server/pricing/queries';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/** PR-9 QA LOW-1: 홈 iSIGN 카드 → iSIGN + iSIGN PKI 가 함께 보이는 카드 묶음 파라미터 `?family=` */
let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
});

afterAll(async () => {
  await handle.close();
});

describe('product-cards', () => {
  it('카드는 ?family=<제품군명>, PRODUCT_FAMILY_MAJORS 로 전개 (iSIGN 만 2개)', () => {
    expect(PRODUCT_CARDS.map(productCardHref)).toEqual([
      '/pricing?family=WAPPLES',
      '/pricing?family=D.AMO',
      '/pricing?family=iSIGN',
      '/pricing?family=Cloudbric',
    ]);
    expect(PRODUCT_FAMILY_MAJORS).toEqual({
      WAPPLES: ['WAPPLES'],
      'D.AMO': ['D.AMO'],
      iSIGN: ['iSIGN', 'iSIGN PKI'],
      Cloudbric: ['Cloudbric'],
    });
    expect(productFamilyMajors('iSIGN')).toEqual(['iSIGN', 'iSIGN PKI']);
    expect(productFamilyMajors('isign')).toEqual(['iSIGN', 'iSIGN PKI']);
    expect(productFamilyMajors('wapples')).toEqual(['WAPPLES']);
    expect(productFamilyMajors('nope')).toBeNull();
  });
});

describe('parsePriceFilter / filterToQuery', () => {
  it('family 는 major 가 없을 때만 살아남고, 쿼리스트링에도 그렇게 나간다', () => {
    expect(parsePriceFilter({ family: 'iSIGN' }).filter).toMatchObject({
      family: 'iSIGN',
      major: undefined,
    });
    expect(parsePriceFilter({ family: 'isign', major: 'iSIGN PKI' }).filter).toMatchObject({
      family: undefined,
      major: 'iSIGN PKI',
    });
    expect(filterToQuery({ family: 'iSIGN', page: 1 })).toBe('?family=iSIGN');
    expect(filterToQuery({ family: 'isign', major: 'iSIGN', page: 1 })).toBe('?major=iSIGN');
  });
});

describe('getPriceRows family', () => {
  it('family=isign 총건수 = major iSIGN + major iSIGN PKI, 모르는 family 는 0, major 가 우선', async () => {
    const count = async (params: Record<string, string>) =>
      (await getPriceRows(handle.db, parsePriceFilter(params).filter)).total;
    const isign = await count({ major: 'iSIGN' });
    const pki = await count({ major: 'iSIGN PKI' });
    expect(await count({ family: 'iSIGN' })).toBe(isign + pki);
    expect(await count({ family: 'isign' })).toBe(isign + pki);
    expect(await count({ family: 'WAPPLES' })).toBe(await count({ major: 'WAPPLES' }));
    expect(await count({ family: 'nope' })).toBe(0);
    expect(await count({ family: 'isign', major: 'WAPPLES' })).toBe(
      await count({ major: 'WAPPLES' }),
    );
  });
});
