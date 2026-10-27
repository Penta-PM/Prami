/** 조달 화면 제목·데이터 기준 안내 (ProcurementHeader). 화면·테스트 공용 */
export const PROCUREMENT_PAGES = {
  performance: {
    title: '조달 실적 현황',
    basis:
      '조달청 종합쇼핑몰 납품요구 기준 · 변경계약은 첫 변경차수로 집계하고 제외 처리한 실적은 빼고 봅니다.',
  },
  items: {
    title: '등록 품목',
    basis: '조달청 종합쇼핑몰 등록 품목 기준 · 계약단가는 0원을 넘는 최근 납품 단가입니다.',
  },
  bids: {
    title: '입찰 공고',
    basis: '나라장터 입찰 공고 중 조달 키워드에 해당하는 공고 기준입니다.',
  },
  admin: {
    title: '조달 관리',
    basis: '조달 수집 데이터 기준 · 변경 내용은 조달 이력과 감사 로그에 함께 기록됩니다.',
  },
} as const;
