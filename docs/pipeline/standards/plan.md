# Plan 표준 프로파일 (② 시스템 요구 · ③ 설계)

공통 규칙·표기: `README.md`. 단계 정의: `docs/pipeline/v-model.md`.

## 넣기

### 1. 요구 정의 — ISO/IEC/IEEE 29148:2018 §5.2.5~5.2.7, 12207:2026 §6.4.3
- **하는 일**: Main 의 UR 을 SR 로 나눕니다. SR 하나에 요구 하나(단일성). "적절히·빠르게·등" 같은 모호어를 쓰지 않고 수치·화면·상태로 씁니다. 모든 UR 이 SR 로, 모든 SR 이 AC 로 추적되게 합니다(요구 집합의 완전성·일관성).
- **산출물**: 스펙 §1 추적표, §2 `<KEY>-SR-n`.
- **생략**: 문서 수준은 SR 1~2개로 충분.

### 2. 품질 요구 — KS X ISO/IEC 25010 / ISO/IEC 25010:2023 (9개 특성)
- **하는 일**: 비기능 요구를 9개 특성(기능 적합성·성능 효율성·호환성·상호작용 능력·신뢰성·보안성·유지보수성·유연성·안전성)으로 훑고, 해당하는 것만 SR 로 씁니다. 예: 모바일 320px 넘침 0 → 상호작용 능력, 원가 payload 키 0 → 보안성.
- **산출물**: SR 머리에 `(25010: 보안성)` 처럼 특성 표시.
- **생략**: S·문서 수준.

### 3. 요구공학 실무 — IREB CPRE Foundation Level v3.3.0
- **하는 일**: 요구 원천(사용자 원문·기존 스펙·코드)을 적고, 범위(비범위)와 맥락 경계를 명시합니다. 상충은 추측하지 않고 Main 에 되묻습니다(검증·협상).
- **산출물**: 스펙 머리 "요구" 줄(원천 msg ID), §4 비범위.
- **생략**: 없음.

### 4. 인수 기준 — Gherkin (Given-When-Then)
- **하는 일**: AC 를 `<KEY>-SR-n.m (⑦) Given … When … Then …` 한 줄로 씁니다(키워드 영어, 내용 한국어, 실행하지 않음). 괄호에 검증 단계 ⑤/⑥/⑦ 을 적습니다. QA 생략 모드 동안 AC 도출에 ISTQB 테스트 설계 기법(동등 분할·경계값·결정표·상태 전이, CTFL 4장)을 쓰고 기법을 적습니다.
- **산출물**: 스펙 §2 AC. Dev 테스트 제목이 이 ID 로 시작합니다.
- **생략**: 없음(S 도 AC 는 씀).

### 5. 접근성 — KWCAG 2.2 (KS X OT0003:2022) / WCAG 2.2 AA (ISO/IEC 40500:2025)
- **하는 일**: 화면이 바뀌는 작업은 AA 기준을 AC 로 씁니다. 자주 쓰는 것: 대상 크기(2.5.8, Prami 는 모바일 44px), 포커스 가림 없음(2.4.11), 대체 텍스트·명도 대비·키보드 조작.
- **산출물**: 해당 AC 에 `(WCAG 2.5.8)` 처럼 조항 표시.
- **생략**: 화면 변경 없음.

### 6. 설계 기록 — ADR(Nygard) · C4 모델
- **하는 일**: 되돌리기 어려운 결정만 `<KEY>-DS-n` 으로 남깁니다: 맥락 / 결정 / 결과(대안·트레이드오프). 구조 그림이 필요하면 C4 의 Context·Container 수준까지만.
- **산출물**: 스펙 §3. L 은 Dev 의 "DS 검토: 이의 없음" 회신 기록.
- **생략**: S·문서 수준.

## 참고 (링크만)
- Nielsen 10 휴리스틱 — https://www.nngroup.com/articles/ten-usability-heuristics/
- ISO 9241-110:2020 상호작용 원칙 — https://www.iso.org/standard/75258.html
- 과기정통부·NIPA SW사업 요구사항 상세화 가이드 — https://www.nipa.kr (자료실, 최신판 확인 후 사용)
- 29148 — https://www.iso.org/standard/72089.html · 25010 — https://www.iso.org/standard/78176.html
- IREB — https://www.ireb.org/downloads · Gherkin — https://cucumber.io/docs/gherkin/reference/
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/ · ADR — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions · C4 — https://c4model.com
