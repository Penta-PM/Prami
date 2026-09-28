import { z } from 'zod';

/**
 * 가격정책 등록·수정 모달 입력 (§4.5.3). `*` 필수: 제품군·품번·품명·단가구분·화폐·단가·적용시작일·단위·변경 사유.
 * 저장 시 source='manual'. 원본 20컬럼 중 id(source_id)·최종여부는 ERP 값이라 수동 행에서는 0/false.
 */
const required = (label: string, max = 200) =>
  z.string().trim().min(1, `${label}을(를) 입력하세요`).max(max, `${max}자 이하로 입력하세요`);

const optional = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력하세요`)
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null);

const amount = (label: string) =>
  z.coerce
    .number({ error: `${label}은(는) 숫자여야 합니다` })
    .min(0, `${label}은(는) 0 이상이어야 합니다`)
    .max(1e15, `${label}이(가) 너무 큽니다`)
    .transform((value) => value.toFixed(2));

export const policyFieldsSchema = z.object({
  productFamily: required('제품군', 50),
  itemCode: required('품번', 50),
  itemName: required('품명'),
  spec: optional(),
  unit: required('단위', 20),
  priceType: optional(50),
  priceCategory: required('단가구분', 50),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, '화폐는 영문 3자입니다'),
  hasCorePrice: z.boolean().default(false),
  unitPrice: amount('단가'),
  remark: optional(500),
  effectiveFrom: z.iso.date('적용시작일(YYYY-MM-DD)을 입력하세요'),
  appliesToAllCustomers: z.boolean().default(false),
  baseCoreCount: z.coerce.number().int('정수를 입력하세요').min(0).max(1_000_000).default(0),
  unitPricePerCore: amount('단가(1코어)').default('0.00'),
  customerCode: z
    .string()
    .trim()
    .max(50)
    .transform((value) => value || '0')
    .default('0'),
  customerNo: optional(50),
  customerName: optional(100),
  /** 변경 사유 (필수 · 감사 로그 reason) */
  reason: required('변경 사유', 500),
});

export const createPolicySchema = policyFieldsSchema;
export const updatePolicySchema = policyFieldsSchema.extend({
  id: z.coerce.number().int().positive(),
});
export const deletePolicySchema = z.object({
  id: z.coerce.number().int().positive(),
  reason: required('변경 사유', 500),
});

export type PolicyInput = z.input<typeof createPolicySchema>;
export type UpdatePolicyInput = z.input<typeof updatePolicySchema>;
export type DeletePolicyInput = z.input<typeof deletePolicySchema>;
export type PolicyFields = z.output<typeof policyFieldsSchema>;
