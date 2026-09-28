/** 클라이언트 컴포넌트가 받는 공지 요약/상세 (서버 모듈을 import 하지 않도록 분리) */
export type NoticeView = {
  id: string;
  title: string;
  authorName: string;
  isImportant: boolean;
  /** YYYY-MM-DD */
  publishedAt: string;
};

export type NoticeDetailView = NoticeView & { body: string };
