import type { ReactNode } from 'react';

import { Button, Input, Select } from '@/components/ui';
import type { AuditFilter } from '@/server/audit/queries';

/** 필터 폼 (GET). 결과는 URL 에 남아 새로고침·공유해도 유지된다 */
export function AuditFilters({ filter, actions }: { filter: AuditFilter; actions: string[] }) {
  return (
    <form
      method="get"
      action="/admin/audit"
      aria-label="감사 로그 필터"
      className="flex flex-wrap items-end gap-3 rounded-[10px] bg-surface-card p-4 shadow-(--hairline-default)"
    >
      <FilterField label="시작일">
        <Input type="date" name="from" defaultValue={filter.from} className="w-[150px]" />
      </FilterField>
      <FilterField label="종료일">
        <Input type="date" name="to" defaultValue={filter.to} className="w-[150px]" />
      </FilterField>
      <FilterField label="행위">
        <Select name="action" defaultValue={filter.action ?? ''} className="w-[200px]">
          <option value="">전체</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </Select>
      </FilterField>
      <FilterField label="사용자">
        <Input
          type="search"
          name="actor"
          defaultValue={filter.actor}
          placeholder="이메일·이름 일부"
          className="w-[200px]"
        />
      </FilterField>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          조회
        </Button>
        <a
          href="/admin/audit"
          className="inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold text-text-tertiary no-underline hover:bg-gray-100 hover:text-ink-900 hover:no-underline"
        >
          초기화
        </a>
      </div>
    </form>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
