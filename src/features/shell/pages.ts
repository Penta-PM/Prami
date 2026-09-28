import type { PlaceholderPageProps } from '@/components/placeholder-page';

export type PageKey = 'calculator' | 'adminParts' | 'adminGroups';

/** 라우트별 자리표시자 정보. 제목은 디자인 메뉴 라벨, 예정 PR 은 스펙 §6 기준 */
export const PAGE_SPECS: Record<PageKey, PlaceholderPageProps> = {
  calculator: {
    title: '계산기',
    description: '견적 계산기와 순매출 계산기를 탭으로 제공합니다.',
    plannedPr: 'PR-7',
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
};
