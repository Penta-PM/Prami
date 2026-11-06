# 파이프라인 V모델 + 역할별 표준 프로파일

- 요구: Main msg_3942cf274ce3 (2026-11-06). 사용자 확정: 파이프라인 전체를 V모델 하나로 · 표기 KS X ISO/IEC + ISO 번호 병기 · Dev 보안 기준에 KISA 포함 · QA 생략 모드 동안 ⑦ 은 Dev(독립성 없음 표시) · 넣기/참고 목록(출처 버전 확정은 Plan 재량).
- ID 접두: PIPE · 수준: 문서(①②⑧) · 기준 SHA: main 3f35adf
- 병렬 검토: 표준 출처·버전 검증(웹 조사) / 양식·흐름 검토(현 규칙 파일 대조). 상충 없음. 아래 §3 결정은 두 검토가 낸 되묻기 후보를 Plan 이 설계 권한으로 정한 것(사용자 확정 사항과 충돌 없음).

## 1. 추적표
| UR (Main 요구) | SR | 산출물 |
|---|---|---|
| V모델 정의 | PIPE-SR-1 | `docs/pipeline/v-model.md` |
| 역할별 표준 프로파일 | PIPE-SR-2 | `docs/pipeline/standards/{README,plan,dev,qa}.md` |
| 역할 파일·verification 수정 | PIPE-SR-3 | `docs/pipeline/roles/*.md`, `verification.md`, `docs/specs/qa-skip-policy.md` |
| M0 는 기존 방식, M1 부터 시범 | PIPE-SR-4 | 적용 시점·순서 |

## 2. 시스템 요구 · AC
- **PIPE-SR-1** V모델 정의
  - PIPE-SR-1.1 Given v-model.md When 읽으면 Then ①~⑧ 단계별 담당·12207 조항·산출물·출구 기준이 한 표에 있다.
  - PIPE-SR-1.2 Given 추적 ID 절 When 읽으면 Then KEY·UR·SR·AC·DS·테스트 이름 규칙과 기존 `AC-n` 비소급 원칙이 있다.
  - PIPE-SR-1.3 Given 맞춤 수준 절 When 변경을 판정하면 Then 문서/S/M/L 이 파일·경로 조건 문장만으로 정해진다.
  - PIPE-SR-1.4 Given QA 생략 모드 When ⑦ 을 보고하면 Then "Dev — 독립성 없음" 이 표기된다.
- **PIPE-SR-2** 표준 프로파일
  - PIPE-SR-2.1 Given standards/*.md When 각 항목을 보면 Then 출처(조항) → 하는 일 → 산출물 → 생략 조건 순이다.
  - PIPE-SR-2.2 Given 역할 파일 When 길이를 재면 Then 각 2쪽(약 80줄) 이내이고 표준 원문 인용이 없다.
  - PIPE-SR-2.3 Given 출처 버전표 When 읽으면 Then KS 번호와 ISO 번호·연도가 병기되고, KS 부합판이 없으면 "(KS 부합판 미확인)" 이 붙는다.
- **PIPE-SR-3** 역할 파일·verification
  - PIPE-SR-3.1 Given roles/*.md When 읽으면 Then 프로파일 링크 1줄과 새 양식이 있고 줄 수가 지금(main 63·plan 70·dev 82·qa 23) ±10 이내다.
  - PIPE-SR-3.2 Given verification.md §1 When 읽으면 Then ⑤ ⑥a ⑦a 이름과 출구 기준이 있고 §3 에 ⑥b·⑦b 사후 확인이 있다. §1 번호는 유지된다.
  - PIPE-SR-3.3 Given 기존 문서 When grep 하면 Then B′ 와 어긋나는 문구(`qa-skip-policy.md` "CI 녹색 확인 후 셀프머지"·"Dev E2E 전체", `verification.md` "QA 재검증 요청", 잘못된 "§3.1"·"§3.2" 참조)가 남지 않는다.
- **PIPE-SR-4** 적용 순서
  - PIPE-SR-4.1 Given M0 진행 중 When 이 PR 을 만들면 Then M0 머지·main 복귀 뒤에 착수하고 M0 PR 에 이 파일들이 섞이지 않는다.

## 3. 설계 결정 (Plan)
- **PIPE-DS-1 ⑥⑦ 을 a/b 로 나눔.** B′(CI 대기 없이 머지)는 사용자 확정 흐름이라 유지. ⑥a·⑦a(로컬, 머지 차단) / ⑥b·⑦b(머지 후 같은 CI run, 사후 확인·빨강이면 수정 PR). 대안 "CI 녹색 후 머지"는 B′ 와 충돌해 기각.
- **PIPE-DS-2 ⑧ 은 :3000 반영 즉시 보고**, ⑥b⑦b 가 진행 중이면 "사후 대기"로 표시하고 결과가 오면 한 줄 추가. 실기기 필요한 인수 기준은 "사용자 확인 필요".
- **PIPE-DS-3 ⑦a 범위 = 영향 E2E + SR 매핑 E2E** (현 verification.md 와 같음, 4코어 호스트). `qa-skip-policy.md` 의 "Dev E2E 전체"는 CI ⑦b 로 갈음한다고 고침.
- **PIPE-DS-4 ID**: KEY 는 Main 이 접수 때 제안, Plan 이 중복 확인 후 확정. AC 는 SR 소속(`KEY-SR-n.m`). 테스트 제목은 ID 로 시작(괄호 없음, `--grep` 편의). PR 대응표에 커밋 열 없음(squash) — 게이트 SHA 를 한 번 적음.
- **PIPE-DS-5 ③ Dev 검토**: M 은 비차단(이의 있으면 착수 전 `question` 1회), L 은 차단("DS 검토: 이의 없음" 회신 후 착수).
- **PIPE-DS-6 보안 기준**: ASVS 5.0.0 L1 기본, 인증·세션·권한·원가·개인정보 경로 변경은 L2. KISA 7분류로 점검. PR 보안 체크는 6항목(N/A 허용) — 전체 체크리스트를 PR 에 붙이지 않음.
- **PIPE-DS-7 출처 버전**: 12207 은 KS(2017 부합) + ISO 2026 병기, 조항 번호는 2026판. KS 부합판 미확인 표준은 ISO 번호만 + "(KS 부합판 미확인)". 초안(SSDF v1.2)은 인용 안 함. 연도 미확인(KISA 가이드, NIPA 가이드)은 "최신판"으로 쓰고 다음 검토(2027-05)에 확정.
- **PIPE-DS-8 양식은 v-model.md 한 곳에**. 역할 파일에는 3~5줄 요약 + 링크만 두어 길이를 유지.

## 4. 작업 (Dev, 문서 전용 PR 1개)
초안은 Plan 이 `docs/specs/pipeline-v-model/` 에 만들어 두었습니다(미커밋). M0 작업 트리와 섞이지 않게 실제 위치(`docs/pipeline/`)에는 아직 쓰지 않았습니다.

1. `git mv` 없이 복사: `docs/specs/pipeline-v-model/v-model.md` → `docs/pipeline/v-model.md`, `…/standards/*.md` → `docs/pipeline/standards/`. 복사 후 `docs/specs/pipeline-v-model/` 폴더는 삭제(커밋에 넣지 않음). 이 스펙 `docs/specs/pipeline-v-model.md` 는 커밋.
2. 아래 §5 대로 역할 파일·verification.md·qa-skip-policy.md 수정. 기준은 main 3f35adf — M0 머지로 이 파일들이 바뀌었으면 그 변경을 살려 합칩니다.
3. 게이트: 문서 전용이라 `pnpm check:secrets` + markdown 링크 경로 확인(상대 경로가 실제 파일을 가리키는지). PR 에 `ci:run` 부착(문서 전용이라 secret scan 만 돎) 후 B′ 머지.

## 5. 수정 내용

### roles/main.md
- "## 책임" 위에 한 줄: `V모델 ①⑧ 담당 — 정의·양식 docs/pipeline/v-model.md, 표준 docs/pipeline/standards/README.md`
- "## Plan 에게 보내는 형식" 블록을 v-model.md §4 ① 양식으로 교체(KEY 제안 · `<KEY>-UR-n` · 인수 기준 · 제약/긴급도/확정된 사항).
- "## 사용자에게 하는 최종 보고 형식" 블록을 v-model.md §4 ⑧ 양식으로 교체(인수 기준별 결과표 · ⑥b⑦b CI 사후 대기 · 백로그).

### roles/plan.md
- "## 책임" 위에 한 줄: `V모델 ②③ 담당 — 양식 docs/pipeline/v-model.md §3·§4, 표준 docs/pipeline/standards/plan.md`
- 책임 5 "스펙 작성" 에 덧붙임: `ID 접두·수준(S/M/L) 판정, SR/DS ID, AC 는 Gherkin 으로 검증 단계(⑤⑥⑦)와 함께 쓴다. L 은 Dev 의 DS 검토 회신 후 착수.`
- "## Dev 에게 배정하는 형식" 블록 축소: `[스펙 + 태스크 배정] <KEY> <제목>` / 스펙 파일·수준 / 태스크·의존 / 반영 후 볼 곳(:3000)·DB. "목표/동작 정의…" 줄과 "## 수용 기준" 블록은 삭제(스펙 §2 가 원본).
- "## 머지 즉시 반영" 절은 `verification.md §3 (B′) 참조` 한 줄로.

### roles/dev.md
- "## 책임" 위에 한 줄: `V모델 ④⑤⑥ (생략 모드면 ⑦ 대행) — 양식 docs/pipeline/v-model.md §4, 표준 docs/pipeline/standards/dev.md`
- 작업 흐름의 `gh pr create … --body "... ## 로컬 검증 ..."` 주석을 `본문 = v-model.md §4 PR 양식(추적표·로컬 검증·보안 체크)` 로.
- 머지 보고 블록에 한 줄 추가: `- SR 통과: n/n (⑦ Dev 수행 — 독립성 없음)`.
- "## 검증 규칙" 요약의 Dev 게이트 줄 앞에 `⑤ ⑥a ⑦a` 표기, 머지 전 줄 뒤에 `머지 후 ⑥b⑦b = 같은 CI run(사후 확인)` 추가.
- 테스트 이름 규칙 한 줄: `새 테스트 제목은 AC ID 로 시작 (MOB-SR-101.2: …). 기존 AC-n 은 그대로.`

### roles/qa.md
- 생략 모드 안내 아래 한 줄: `V모델 ⑦ 담당(생략 모드 동안 Dev 대행, 독립성 없음) — 표준 docs/pipeline/standards/qa.md`
- 책임 1 "수용 기준대로" → "스펙 SR AC(ID)별로 판정하고 결과 표에 검증 SHA 를 적습니다".

### verification.md
- 머리 "단일 원본" 문단의 "각 역할 워크트리의 CLAUDE.md … 보지 못한다" 두 줄을 `역할 규칙은 docs/pipeline/roles/*.md, 단계 정의는 docs/pipeline/v-model.md 를 따른다.` 로 교체.
- §1 제목 → `## 1. Dev 게이트 (로컬, PR 올리기 전) — ⑤ 단위 · ⑥a 통합 · ⑦a 시스템`. 표에 "V단계" 열 추가: check·coverage = ⑤, build·prerender·trace·secrets = ⑤, integration = ⑥a, 영향 E2E = ⑦a. 영향 E2E 줄의 "E2E 전체는 Dev 가 돌리지 않는다(QA 몫)" → "영향 + SR AC 매핑 E2E. 전체 E2E 는 CI ⑦b".
- §1 끝에 출구 기준 블록:
  ```
  출구 기준: ⑤ 전부 통과·coverage 80% / ⑥a integration 전부 통과(격리 DB) / ⑦a 영향·SR 매핑 E2E 전부 통과.
  PR 본문에 추적표(ID·단계·테스트·결과)·로컬 검증·보안 체크(v-model.md §4).
  ```
- §2 제목 → `## 2. QA 검증 (로컬) — ⑦ (QA 모드일 때만; 생략 모드면 §1 ⑦a 로 갈음, "독립성 없음" 표시)`.
- §3 2번 끝에 한 줄: `⑥b·⑦b 사후 확인 = 이 CI run 의 integration·e2e job 녹색. Main 은 ⑧ 보고에 결과를 덧붙인다.`
- §4 표 "실제 버그" 조치 "수정 → QA 재검증 요청" → "수정 PR(QA 모드면 재검증 요청)".
- §5 표준 문구 교체:
  > Dev 게이트 ⑤⑥a⑦a 기록(§1) + PR 추적표 + `ci:run` 부착 후 머지 · 머지 후 ⑥b⑦b CI 녹색(빨강이면 수정 PR, §3)

### docs/specs/qa-skip-policy.md
- "절차" 줄의 `§3.1`·"`ci:run` 녹색 확인 후 셀프머지" → `verification.md §1 Dev 게이트(⑤⑥a⑦a) 후 ci:run 부착·B′ 셀프머지(§3), 머지 후 CI ⑥b⑦b 사후 확인`.
- "QA E2E 전체 1회(§3.2) … Dev E2E 전체 실행으로 갈음" → `QA ⑦ 은 Dev ⑦a(영향·SR 매핑 E2E) + CI ⑦b(전체 E2E)로 갈음, 보고에 "독립성 없음"`.
- 끝에 `(2026-11-06 V모델 도입으로 문구 정리 — docs/specs/pipeline-v-model.md)`.

## 6. 비범위 · 진행 기록
- 비범위: 앱 코드, CI 워크플로 변경, ID↔테스트 자동 대조 스크립트(백로그), 기존 스펙 소급, M0.
- 백로그: 테스트 제목 ID 와 스펙 추적표를 대조하는 grep 스크립트 · `ci.yml:5` 주석의 구 QA 문구 정리.
- 2026-11-06 병렬 검토 후 스펙·초안 작성. M0 머지 후 Dev 배정 예정. M1 은 이 PR 머지 뒤 V모델로 배정(KEY=MOB, 수준 M, 스펙 mobile-ui.md 에 M1 SR·공통 SR 0xx 를 Plan 이 추가).
