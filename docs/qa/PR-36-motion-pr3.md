# QA 기록 — PR #36 Motion 도입 PR-3 전환·피드백

- 대상: `feat/motion-pr3-transitions` @ `b05248e` (base `origin/main` @ `37fba53`)
- 판정 (2026-10-02): **통과 / 셀프머지 승인**
- 스펙: `docs/specs/motion-interactions.md` §6 PR-3, §9.3

## 실측 요약
- 사이드바: 접을 때 아이콘 x 가 main 과 프레임 단위로 같은 값(음수 없음). 라벨은 펼칠 때만 fade-in(약 118ms), 접을 때 즉시 제거. 폭 transition 200ms 그대로
- 모바일: 백드롭 fade-in 0.2s, 닫힌 뒤 visibility hidden
- Segmented: layoutId 슬라이드(오버슈트 0.15px). CalculatorTabs: fade-up, 클릭 후 첫 프레임부터 입력 가능
- 폼 에러: 모달 5곳 모두 39.5px 로 표시(shrink-0 수정 확인). 성공 배너 height+fade, role 유지
- 쉬고 있을 때 외형이 main 과 같음(데이터 차이만). 콘솔 0
- typecheck·lint 0·단위 1757·E2E 66/66 (애니메이션 끔·켬 모두, shell·a11y-responsive 포함). 데이터 중복 0

## 백로그 (비블로킹)
1. shrink-0 회귀를 잡는 테스트 없음 (지우면 단위·E2E 통과, 화면에서는 높이 0)
2. CalculatorTabs "퇴장 대기 없음" 테스트가 skipAnimations 상태라 mode="wait" 를 못 잡음
3. §9.3 "접을 때 라벨 즉시 제거" 단위 테스트 없음. 컴포넌트에 직접 넣은 bouncy spring 을 못 잡음
4. 모바일 사이드바 슬라이드가 애니메이션되지 않음 (Tailwind 4 translate 와 transition 목록 불일치, main 도 같음). 백드롭 퇴장 fade 없음
5. UploadSummary ErrorList 는 모션 대상에서 빠짐 (범위 판단)
6. ImportFileRow "기존 파일 선택" 포커스 링이 Collapse overflow-hidden 에 잘릴 가능성 (미실측)
7. 배너가 접히는 동작은 화면에서 재현 경로가 없어 단위 테스트로만 확인
