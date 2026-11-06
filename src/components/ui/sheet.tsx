'use client';

import { Modal, type ModalProps } from './modal';

export type BottomSheetProps = Omit<ModalProps, 'layout' | 'size'>;

/**
 * 공용 하단 시트 — 폭과 상관없이 시트로 연다(모바일 전용 진입점: 헤더 계정 시트 등). 동작(포커스·Esc·백드롭·퇴장)은 Modal 과 같다.
 * 일반 Modal 은 `max-md` 에서 같은 모양으로 바뀐다(layout="auto").
 */
export function BottomSheet(props: BottomSheetProps) {
  return <Modal {...props} layout="sheet" />;
}
