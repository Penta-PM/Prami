import { z } from 'zod';

const itemCode = z.string().trim().min(1, '품번을 입력하세요').max(50);

/** 수동 매핑 저장 (§4.3.6): 모델 1 + 파츠 n(중복 제거, 모델 자신 제외) */
export const savePartMappingSchema = z
  .object({
    modelItemCode: itemCode,
    partItemCodes: z
      .array(itemCode)
      .min(1, '파츠를 하나 이상 선택하세요')
      .max(200)
      .transform((codes) => [...new Set(codes)]),
  })
  .refine((value) => !value.partItemCodes.includes(value.modelItemCode), {
    message: '모델 자신을 파츠로 등록할 수 없습니다',
    path: ['partItemCodes'],
  });

export const deletePartMappingSchema = z.object({ modelItemCode: itemCode });

export const applyPartImportSchema = z.object({
  batchId: z.uuid('파츠 파일을 선택하세요'),
  reused: z.boolean(),
});

export type SavePartMappingInput = z.input<typeof savePartMappingSchema>;
export type DeletePartMappingInput = z.input<typeof deletePartMappingSchema>;
export type ApplyPartImportInput = z.input<typeof applyPartImportSchema>;
