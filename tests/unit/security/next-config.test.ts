// @vitest-environment node
import { describe, expect, it } from 'vitest';

import nextConfig from '../../../next.config';

/**
 * PRAMI-002 QA H-1: 개발 모드 Server Function 인자 로깅(Next 기본 true)을 끈 설정을 고정한다.
 * 실제 dev 서버 로그에 키 0건은 E2E `settings-llm.spec.ts`(scripts/e2e-dev-server.ts 로그 캡처)가 증명한다.
 */
describe('next.config 로깅', () => {
  it('logging.serverFunctions 가 false (logging 자체는 켜 둠 — 요청 로그 유지)', () => {
    expect(nextConfig.logging).not.toBe(false);
    expect(nextConfig.logging && nextConfig.logging.serverFunctions).toBe(false);
  });
});
