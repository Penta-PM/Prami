import type { PlaceholderPageProps } from '@/components/placeholder-page';

export type PageKey =
  | 'home'
  | 'pricing'
  | 'calculator'
  | 'notices'
  | 'search'
  | 'adminPolicies'
  | 'adminCosts'
  | 'adminParts'
  | 'adminGroups'
  | 'adminNotices';

/** 라우트별 자리표시자 정보. 제목은 디자인 메뉴 라벨, 예정 PR 은 스펙 §6 기준 */
export const PAGE_SPECS: Record<PageKey, PlaceholderPageProps> = {
  home: {
    title: 'HOME',
    description: '제품 바로가기 카드와 최근 공지사항 5건을 표시합니다.',
    plannedPr: 'PR-9',
  },
  pricing: {
    title: '가격 정책 조회',
    description: '분류 3단 필터·날짜 필터·검색으로 판매단가 이력을 조회합니다.',
    plannedPr: 'PR-4',
  },
  calculator: {
    title: '계산기',
    description: '견적 계산기와 순매출 계산기를 탭으로 제공합니다.',
    plannedPr: 'PR-7',
  },
  notices: {
    title: '공지사항',
    description: '공지사항 목록과 상세를 표시합니다.',
    plannedPr: 'PR-9',
  },
  search: {
    title: '검색',
    description: '상단 검색바 결과(품목·공지)를 표시합니다.',
    plannedPr: 'PR-9',
  },
  adminPolicies: {
    title: '가격정책 관리',
    description: 'ERP 판매단가 파일 임포트·적용과 정책 등록/수정/삭제를 관리합니다.',
    plannedPr: 'PR-3 · PR-4',
  },
  adminCosts: {
    title: '원가 관리',
    description: '구매단가(원가) 파일 임포트와 원가 조회·수정을 관리합니다. 관리자 전용입니다.',
    plannedPr: 'PR-5',
  },
  adminParts: {
    title: '파츠 관리',
    description: '모델별 장착 가능 파츠 매핑을 관리합니다.',
    plannedPr: 'PR-6',
  },
  adminGroups: {
    title: '솔루션 그룹 관리',
    description: '견적에 사용하는 솔루션 그룹 구성을 관리합니다.',
    plannedPr: 'PR-6',
  },
  adminNotices: {
    title: '공지사항 관리',
    description: '공지사항 등록·수정·삭제를 관리합니다.',
    plannedPr: 'PR-9',
  },
};
