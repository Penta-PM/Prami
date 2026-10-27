import { getDb } from '@/db';
import {
  EXPORT_TRUNCATED_HEADER,
  itemFilterDefs,
  parseItemsView,
  PROCUREMENT_ITEMS_EXPORT_PATH,
  toItemQueryFilter,
} from '@/features/procurement/items/filter';
import { choicesOf } from '@/features/procurement/items/view-state';
import { itemsXlsxBuffer } from '@/features/procurement/items/xlsx';
import { formatDate } from '@/lib/date-format';
import { runProcurementRoute } from '@/server/procurement/access';
import {
  getProcurementItemFacets,
  getProcurementItemRowsForExport,
  PROCUREMENT_ITEM_EXPORT_LIMIT,
} from '@/server/procurement/queries';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 등록 품목 xlsx 내려받기 (조달이 통합 UI-2, procurement.read). 화면과 같은 URL(검색·열 필터·정렬)을 같은 파서·화이트리스트로 읽고
 * 페이지는 무시한다. 상한 PROCUREMENT_ITEM_EXPORT_LIMIT(10,000)건 — 넘으면 앞에서부터 상한까지 + 안내.
 * 비로그인은 proxy 가 /login 으로 보내고, 권한 없음은 403 봉투 + 감사 denied(runProcurementRoute).
 */
export async function GET(request: Request): Promise<Response> {
  return runProcurementRoute('read', PROCUREMENT_ITEMS_EXPORT_PATH, async (access) => {
    const db = await getDb();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const facets = await getProcurementItemFacets(access, db);
    const view = parseItemsView(params, itemFilterDefs(choicesOf(facets)));
    // 페이지는 내려받기와 무관 — 조회 계층의 export 필터에는 page·pageSize 가 없다
    const filter = toItemQueryFilter(view);
    delete filter.page;
    const { rows, truncated } = await getProcurementItemRowsForExport(access, db, filter);
    const body = await itemsXlsxBuffer(rows, {
      truncated,
      limit: PROCUREMENT_ITEM_EXPORT_LIMIT,
    });
    const fileName = `procurement-items-${formatDate(new Date())}.xlsx`;
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': XLSX_TYPE,
        'content-disposition': `attachment; filename="${fileName}"`,
        'cache-control': 'no-store',
        [EXPORT_TRUNCATED_HEADER]: truncated ? '1' : '0',
      },
    });
  });
}
