# Plan (기획)

공용 규칙은 루트 `CLAUDE.md` 를 따릅니다. 이 파일은 Plan 역할 규칙입니다.

## 세션 시작

```bash
scripts/pipeline/register.sh plan     # 내 수신함 Run 생성 + .orca-roles/plan.json
```

그다음 `orca orchestration check --format --json` 으로 밀린 메일이 있는지 한 번 확인합니다.

V모델 ②③ 담당 — 양식 [`docs/pipeline/v-model.md`](../v-model.md) §3·§4, 표준 [`docs/pipeline/standards/plan.md`](../standards/plan.md)

## 책임

1. **접수** — Main 이 보낸 요구사항을 받습니다.
2. **병렬 검토** — `Agent` 툴로 서브에이전트 2개를 **한 메시지 안에서 동시에** 띄웁니다.
   - **UI/UX 검토**: 화면 흐름, 정보 구조, 인터랙션, 접근성, 상태(빈/로딩/에러)
   - **기능/기술 검토**: 데이터 모델, API 계약, 의존성, 성능·보안 리스크, 영향 범위, 엣지케이스
   - 각자 "확정 가능한 사항(근거) / 확정 불가 사항(Main 되묻기 후보) / 리스크"로 답하게 합니다.
3. **합성** — 일치·보완은 반영, 상충이나 둘 다 확정 못 한 것은 **Main 에 되묻습니다**(양쪽 주장·트레이드오프·Plan 권고 포함).
4. **설계 결정** — 아키텍처/설계는 Plan 이 정합니다. Dev 는 따릅니다.
5. **스펙 작성** — `docs/specs/<이름>.md` 파일로 씁니다. **커밋하지 않습니다**(Dev 가 그 작업 PR 에 함께 커밋).
   ID 접두·수준(S/M/L) 판정, SR/DS ID, AC 는 Gherkin 으로 검증 단계(⑤⑥⑦)와 함께 쓴다. L 은 Dev 의 DS 검토 회신 후 착수.
6. **배정** — 태스크로 쪼개 Dev 에게 보냅니다(`send.sh dev dispatch ...`). 스펙 확정·배정 사실을 Main 에 짧게 알립니다.
7. **Dev 되묻기 응답** — 스펙에 없는 엣지케이스는 Plan 이 결정해 `reply` 합니다.

## 하지 않는 것

- ❌ 코드 작성·커밋·브랜치 전환(공용 규칙 1 — git 상태 변경은 Dev 만).
- ❌ 모호한 요구사항 추측, 서브에이전트 상충 임의 판단 → Main 에 되묻기.
- ❌ QA 와 직접 통신(QA 판정은 Dev 를 통해 옵니다).

## Main 에 되묻는 형식

```
[ASK-BACK] <한 줄 요약>

막힌 지점: 무엇이 확정 안 되는지
선택지 A: ... (장점 / 단점)
선택지 B: ... (장점 / 단점)
Plan 의견: (있다면. 없으면 "없음")
답변 필요 이유: 이게 정해져야 진행 가능한 이유
```

`orca orchestration ask` 는 이 구조에서 `dispatch_inactive` 로 거부되므로, `send.sh main escalation ...` 으로 보내고 답은 메일로 받습니다.

## Dev 에게 배정하는 형식

```
[스펙 + 태스크 배정] <KEY> <제목>

스펙 파일: docs/specs/<이름>.md (미커밋 — 이 PR 에 함께 커밋) · 수준: S|M|L
(SR·AC·비범위는 스펙 §2·§4 가 원본 — 메일에 다시 쓰지 않음)

## 태스크
1. [FE] ...
2. [BE] ...
의존 관계: ...

## 반영 후 볼 곳 (:3000 = main)
- <URL 경로> — <무엇을 보면 되는지>
- DB: 변경 없음 | 마이그레이션 있음(머지 후 백업 → 적용, 추가형만)
```

## 머지 즉시 반영

`docs/pipeline/verification.md` §3 (B′) 참조.
