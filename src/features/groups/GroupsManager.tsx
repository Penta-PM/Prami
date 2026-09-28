'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Modal } from '@/components/ui';
import type { ActionResult } from '@/lib/result';
import { priceLabel } from '@/lib/pricing/format';

import { deleteSolutionGroupAction } from './actions';
import { GroupFormModal, type GroupFormMode } from './GroupFormModal';
import type { GroupCandidateView, SolutionGroupView } from './types';

type GroupsManagerProps = {
  family: string;
  groups: readonly SolutionGroupView[];
  candidates: readonly GroupCandidateView[];
};

/** 솔루션 그룹 관리 (§4.5.6, AC-33): 카드(그룹명 + 항목 칩·현재 단가) · 생성/수정 모달 · 삭제(soft) */
export function GroupsManager({ family, groups, candidates }: GroupsManagerProps) {
  const router = useRouter();
  const [form, setForm] = useState<GroupFormMode | null>(null);
  const [deleting, setDeleting] = useState<SolutionGroupView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const done = (verb: string) => (result: ActionResult<{ id: string; name: string }>) => {
    if (!result.ok) return;
    setForm(null);
    setDeleting(null);
    setFlash(`${verb}했습니다: ${result.data.name}`);
    router.refresh();
  };

  const remove = () =>
    startTransition(async () => {
      if (!deleting) return;
      done('삭제')(await deleteSolutionGroupAction({ id: deleting.id }));
    });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setForm({ kind: 'create' })}>
          + 그룹 생성
        </Button>
      </div>
      {flash ? (
        <p
          role="status"
          className="m-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-600"
        >
          {flash}
        </p>
      ) : null}
      <ul aria-label="솔루션 그룹 목록" className="m-0 flex list-none flex-col gap-3.5 p-0">
        {groups.map((group) => (
          <li
            key={group.id}
            className="rounded-xl bg-surface-card px-6 py-5 shadow-(--hairline-default)"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-[15px] font-semibold">{group.name}</h2>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  aria-label={`${group.name} 수정`}
                  className="border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold text-purple-500 hover:underline"
                  onClick={() => setForm({ kind: 'edit', group })}
                >
                  수정
                </button>
                <button
                  type="button"
                  aria-label={`${group.name} 삭제`}
                  className="border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold text-red-500 hover:underline"
                  onClick={() => setDeleting(group)}
                >
                  삭제
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span
                  key={item.itemCode}
                  className="rounded-pill bg-gray-100 px-2.5 py-[5px] text-[11px] font-medium text-text-secondary"
                >
                  {item.itemName}
                  {item.defaultQty > 1 ? ` ×${item.defaultQty}` : ''}
                  <span className="ml-1 text-text-tertiary">
                    {item.unitPrice && item.currency
                      ? priceLabel(item.unitPrice, item.currency)
                      : '가격 미등록'}
                  </span>
                </span>
              ))}
            </div>
          </li>
        ))}
        {groups.length === 0 ? (
          <li className="rounded-xl bg-surface-card p-12 text-center text-[13px] text-text-tertiary shadow-(--hairline-default)">
            등록된 솔루션 그룹이 없습니다.
          </li>
        ) : null}
      </ul>
      {form ? (
        <GroupFormModal
          mode={form}
          family={family}
          candidates={candidates}
          onClose={() => setForm(null)}
          onDone={done(form.kind === 'edit' ? '수정' : '생성')}
        />
      ) : null}
      {deleting ? (
        <Modal
          open
          onClose={() => setDeleting(null)}
          title="그룹 삭제"
          footer={
            <>
              <Button size="sm" onClick={() => setDeleting(null)}>
                취소
              </Button>
              <Button size="sm" variant="danger" disabled={isPending} onClick={remove}>
                삭제
              </Button>
            </>
          }
        >
          <p className="m-0">
            <strong className="text-ink-900">{deleting.name}</strong> 그룹을 삭제합니다. 견적
            계산기의 그룹 칩에서 사라지며 감사 로그에 남습니다.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
