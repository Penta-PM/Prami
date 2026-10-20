# LAN 개발 DB 마이그레이션 미적용 — 긴급 복구 + 재발 방지

- 요구사항: Main msg_ddf393d329c1 (2026-10-20, 긴급). 사용자 보고: 가격정책 화면 로드 실패(digest 2162936993).
- Main 진단: `relation "cost_item_links" does not exist (42P01)` — `PricingSection.tsx:56` → `getCostRatios`(`src/server/cost/price-ratio.ts:55`).
  `drizzle/0009_cost_item_links.sql`(#53)이 LAN 개발 DB 에 적용되지 않은 채 #55 코드가 실행됨. 10-16 `/api/notifications` 500 도 같은 유형(0008).
- 이 건은 긴급이라 서브에이전트 병렬 검토를 생략하고 Plan 이 바로 결정했다(원인이 진단으로 확정, 변경 범위가 작음).

## 1. T1 — 긴급 복구 (Dev, PR 없음)
1. LAN 서버가 쓰는 DB 접속 정보를 Main 워크트리의 env 파일에서 **읽기만** 해 확인(Main 워크트리 파일 수정·프로세스 조작 금지, :3000·LAN 서버 재시작 금지).
2. 적용 전 백업: `docker exec prami-postgres-1 pg_dump …` 를 스크래치 경로에 저장(컨테이너 중지·재시작 금지).
3. **현재 origin/main 과 같은 코드**(Dev 작업 브랜치가 아닌 main 기준 — 미머지 마이그레이션이 섞이지 않게)에서, 위 DB 를 대상으로 `pnpm db:migrate` 실행.
4. 확인: `__drizzle_migrations`(또는 drizzle 기록 테이블)의 적용 목록이 `drizzle/` 의 main 마이그레이션 전부와 일치, `cost_item_links`·`notifications` 존재, 기존 테이블 행 수 변화 없음.
5. LAN 서버로 `/admin/policies`·`/pricing`·알림 종 정상 로드 확인(서버 재시작 없이). 결과를 Plan 과 Main 에 보고.

## 2. T2 — 재발 방지 (Dev, 작은 PR 1개)
1. **머지 체크리스트**: `docs/pipeline/verification.md` 에 "마이그레이션(`drizzle/*.sql`)이 포함된 PR 은 머지 직후 LAN 개발 DB 에 `pnpm db:migrate` 적용 + 적용 목록 확인 후 머지 보고에 기록" 단계를 추가.
2. **부팅 시 감지**: 개발 서버 기동 시(instrumentation) 미적용 마이그레이션이 있으면 콘솔에 눈에 띄는 경고(파일명 목록 + `pnpm db:migrate` 안내). 운영(Vercel) 빌드·런타임 동작은 바꾸지 않음. 자동 적용은 하지 않는다.
3. **부가 기능 실패 격리**: 원가 비중(`getCostRatios`)은 보조 정보이므로 실패해도 가격정책 화면 전체가 죽지 않게 한다.
   - 오류는 서버 로그에 남기고, 관리 표의 원가 비중 칸은 '—', 표 위에 관리자용 안내 "원가 비중을 계산하지 못했습니다. 관리자에게 문의하세요." (원가 열람 권한 사용자에게만 — 권한 없는 사용자에게는 원래 열이 없음).
   - 가격 행 조회(본 기능) 실패는 기존대로 오류 화면. 격리 대상은 보조 쿼리만.
   - 알림 종: `/api/notifications` 실패 시 드롭다운 오류 상태로 표시하고 폴링은 다음 주기에 재시도(이미 그렇다면 테스트만 추가).

## 3. 비범위
- 운영 DB 마이그레이션 자동화, 개발 서버의 자동 마이그레이션, 다른 화면의 일반적 오류 경계 재설계.

## 4. 수용 기준
- [ ] T1: LAN 개발 DB 에 main 마이그레이션 전부 적용(적용 목록 첨부), 기존 데이터 행 수 무변화, 백업 파일 경로 보고, `/admin/policies`·`/pricing` 정상 로드.
- [ ] T2-1: verification.md 에 마이그레이션 적용 단계 추가.
- [ ] T2-2: 미적용 마이그레이션이 있는 DB 로 개발 서버 기동 시 경고 출력(단위 또는 스크립트 테스트), 모두 적용 상태면 경고 없음.
- [ ] T2-3: `cost_item_links` 가 없는 DB(테스트 픽스처)에서 `/admin/policies` 가 200 으로 렌더되고 원가 비중 '—' + 관리자 안내, 권한 없는 사용자에게 안내 없음. 가격 행 쿼리 실패는 기존 오류 화면.
- [ ] Dev 게이트 기록(§3.1) + QA E2E 전체 1회(§3.2) + 머지 head SHA의 `ci:run` 녹색(§3.3)

## 5. 순서
T1 즉시(진행 중 작업보다 우선). T2 는 진행 중인 열 필터 A-2(#57) 재검증 다음.
