import { z } from 'zod';

import { ROLES } from '@/lib/constants/permissions';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력하세요`)
    .transform((value) => (value === '' ? null : value))
    .nullish();

/** 이메일 사전 등록 (§4.5.10: 역할·부서 지정, created_via='admin') */
export const createUserSchema = z.object({
  // trim·소문자화를 먼저 한 뒤 형식을 검사한다 (z.email() 의 체크는 trim 보다 먼저 실행됨)
  email: z.string().trim().toLowerCase().pipe(z.email('이메일 형식이 아닙니다')),
  name: optionalText(50),
  department: optionalText(50),
  role: z.enum(ROLES),
});

export const updateUserSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, '이름을 입력하세요').max(50),
  department: optionalText(50),
  role: z.enum(ROLES),
  status: z.enum(['active', 'inactive']),
});

export const deactivateUserSchema = z.object({ id: z.uuid() });

export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;
export type DeactivateUserInput = z.input<typeof deactivateUserSchema>;
