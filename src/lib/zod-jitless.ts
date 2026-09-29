import { z } from 'zod';

/**
 * zod v4 는 첫 객체 파싱 때 `new Function("")` 으로 eval 가능 여부를 탐지하고 가능하면 JIT 파서를 만든다.
 * CSP 에 `'unsafe-eval'` 이 없으므로(§4.8, AC-91) 탐지 자체가 `script-src` 위반 보고를 남긴다 (PR-11a QA L-1).
 * jitless 로 두면 탐지·eval 없이 같은 결과를 낸다. 클라이언트에서 zod 로 파싱하는 모듈은 이 파일을 먼저 import 한다.
 */
z.config({ jitless: true });

export { z };
