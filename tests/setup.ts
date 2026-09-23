import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { createElement, type ImgHTMLAttributes } from 'react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// next/image 는 jsdom 에서 최적화 로더가 필요 없으므로 일반 <img> 로 대체한다.
vi.mock('next/image', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    const { priority, ...rest } = props;
    void priority;
    return createElement('img', rest);
  },
}));

// jsdom 은 <dialog>.showModal()/close() 를 구현하지 않는다. 최소 동작만 폴리필한다.
// DB 테스트(@vitest-environment node)에는 DOM 이 없으므로 건너뛴다.
type DialogProto = HTMLDialogElement & { showModal(): void; close(): void };
if (typeof HTMLDialogElement !== 'undefined') {
  const dialogProto = HTMLDialogElement.prototype as DialogProto;
  if (typeof dialogProto.showModal !== 'function') {
    dialogProto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (typeof dialogProto.close !== 'function') {
    dialogProto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}
