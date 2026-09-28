import { z } from 'zod';

import { withParticle } from '@/lib/korean';

const required = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${withParticle(label, '을/를')} 입력하세요`)
    .max(max, `${label}은(는) ${max}자 이하로 입력하세요`);

/** 공지 등록·수정 (§4.3.9, 디자인 "공지사항 등록/수정": 제목·작성자·내용·중요 표시). id 가 있으면 수정 */
export const upsertNoticeSchema = z.object({
  id: z.uuid().optional(),
  title: required('제목', 200),
  authorName: required('작성자', 50),
  body: required('내용', 20_000),
  isImportant: z.boolean().default(false),
  /** 비우면 오늘 */
  publishedAt: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.iso.date('작성일(YYYY-MM-DD)을 입력하세요').optional()),
});

export const deleteNoticeSchema = z.object({ id: z.uuid() });

export type UpsertNoticeInput = z.input<typeof upsertNoticeSchema>;
export type DeleteNoticeInput = z.input<typeof deleteNoticeSchema>;
