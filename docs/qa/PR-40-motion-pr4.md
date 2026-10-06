# QA 기록 — PR #40 Motion 도입 PR-4 목록·메시지

- 대상: `feat/motion-pr4-lists` @ `8217121` (base `origin/main` @ `d40d59d`)
- 상태 (2026-10-06): **검증 보류** — Dev 요청(#30 챗봇 FAB 제거를 먼저 머지, 그 위로 rebase 후 새 SHA 로 재요청)
- 보류 전에 발견한 **CRITICAL 1건**을 Dev 에 미리 통보함 (재검증 전에 수정 요청)

## CRITICAL (선행 통보)
1. QuoteSteps 제품군 전환(WAPPLES → D.AMO) 시, 퇴장하는 중분류 칩이 layout 을 유지한 채 약 220px 아래로 미끄러지며 STEP 1·2 카드 위를 지나감
   - §9.4 허용 범위("160ms 겹침")를 넘음. main 에서는 한 프레임에 교체됨
   - 증거: scratchpad `fe35/qs40-pr.out`, `fe35/shots40/family-switch-strip.png`

## 8217121 에서 확인한 것 (rebase 후 diff 가 같으면 재사용)
- CartPanel·PartsEditor·GroupsManager·FamilyTabs·ProductCards·표 <tr> 실측 정상, 쉬고 있을 때 외형 main 과 같음
- typecheck·lint 0, 단위 1784 통과(+ flake 1건), E2E 전체 1회 66/66, 애니메이션 켠 영향 스펙 15/15, 데이터 중복 0
- 챗 버블은 ChatPanel 변경 예정이라 rebase 후 재측정

## 백로그 (비블로킹)
1. `lists.test.tsx` 실제 애니메이션 CartPanel·PartsEditor 테스트가 고부하에서 flake (160ms 퇴장 안에서 60ms 대기 후 존재 단언)
2. 챗 버블 `layout`, Cart·칩의 layout·퇴장 방식, `<tr>` 모션을 지켜 보는 테스트 없음 (jsdom 한계 — 정적 가드 권장)
3. 장바구니 3개 상태 main 대비 2,781px 차이 — 서브픽셀 글자 스냅, 형상 동일
4. 삭제 후 포커스가 body 로 감 (Cart 는 main 과 같음, 칩·그룹은 main 대조 미완)
