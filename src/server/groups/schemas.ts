import { z } from 'zod';

import { withParticle } from '@/lib/korean';

const itemCode = z.string().trim().min(1).max(50);

/** 솔루션 그룹 등록/수정 (§4.3.7): 그룹명 + 항목(품번·기본 수량). 가격은 저장하지 않는다 */
export const upsertSolutionGroupSchema = z.object({
  id: z.uuid().optional(),
  productFamily: z
    .string()
    .trim()
    .min(1, `${withParticle('제품군', '을/를')} 선택하세요`)
    .max(50),
  name: z
    .string()
    .trim()
    .min(1, `${withParticle('그룹명', '을/를')} 입력하세요`)
    .max(100),
  items: z
    .array(
      z.object({
        itemCode,
        defaultQty: z.coerce.number().int().min(1).max(9999).default(1),
      }),
    )
    .min(1, '항목을 하나 이상 선택하세요')
    .max(200)
    .refine((list) => new Set(list.map((item) => item.itemCode)).size === list.length, {
      message: '같은 품번이 두 번 들어 있습니다',
    }),
});

export const deleteSolutionGroupSchema = z.object({ id: z.uuid() });

export type UpsertSolutionGroupInput = z.input<typeof upsertSolutionGroupSchema>;
export type DeleteSolutionGroupInput = z.input<typeof deleteSolutionGroupSchema>;
