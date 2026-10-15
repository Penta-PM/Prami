# 로컬(:3000) 실데이터 운영 전환 (PRAMI-003 U-7)

사용자 요구(원문): "이제 테스트모드같은 더미데이터가 아니라 진짜 배포를 위해서 진짜 데이터를 넣어야해".
이 문서는 스펙 §4.9.4(테스트 모드 제거 경로)·§4.9.6(로컬 DB 재구성)·§4.9.7(감사 로그 보존)·§4.9.8(ADMIN 부트스트랩)의 실행 절차다.
**실행 주체는 Main**(dev 서버·DB 컨테이너 관리)이고, Dev·QA 는 격리 컨테이너(`prami-qa-*`)로 리허설만 한다.
운영·preview 배포 설정은 [`vercel.md`](vercel.md) 를 본다.

> 원칙: 실데이터는 원본 엑셀 3종(판매단가·품목조회 5파일·원가)을 **정식 임포트 경로**(`/admin/policies` 화면 또는 `pnpm import:source`)로만 넣는다.
> 공지·견적·솔루션 그룹·파츠 매핑은 빈 상태로 시작해 관리자가 앱에서 입력한다. `pnpm seed` 는 로컬 :3000 DB 에 실행하지 않는다
> (seed 는 `PRAMI_ALLOW_SEED=1` 이 있는 CI·E2E·격리 DB 에서만 동작 — `.env.local` 에 두지 않는다).

## 1. 테스트 모드 제거 경로 — 로컬 실 Google 로그인 (§4.9.4)

| 단계 | 조건 | 로컬 :3000 `.env.local` (값은 Main 만 보관 — 아래는 키 이름) |
| --- | --- | --- |
| **T-0** 현재 | 로컬 OAuth 클라이언트 미제공(UP-4a 대기) | `AUTH_TEST_MODE=true`·`AUTH_TEST_PASSWORD` 유지. 로그인 이메일은 **실제 관리자 회사 이메일**(UP-7 전에는 운영자 본인)만 쓰고 `fixture-` 이메일은 쓰지 않는다. 테스트 로그인도 로그인 정책(`signInWithPolicy`)을 거쳐 허용 도메인 계정만 자동 생성되고, `ADMIN_EMAILS` 에 있으면 ADMIN 이 된다 |
| **T-1** 전환 | UP-4a 도착 | `AUTH_GOOGLE_ID`·`AUTH_GOOGLE_SECRET` = `prami-dev` 클라이언트, `AUTH_URL=http://localhost:3000`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, `AUTH_REQUIRE_HD=true`(PR-3 이후), **`AUTH_TEST_MODE`·`AUTH_TEST_PASSWORD` 삭제**. dev 서버 재시작 후 `/login` 에 Google 버튼만 있고 TEST MODE 배너·테스트 폼이 없다. T-0 에서 만든 계정은 같은 이메일이라 그대로 이어진다(이메일 기준 매칭) |
| **T-2** 이후 | — | CI·E2E·QA·Dev 격리 DB 는 테스트 모드 유지(운영·preview 차단은 그대로). 로컬 :3000 만 실로그인 |

- Google 콘솔 동의 화면·클라이언트 생성 절차는 [`oauth.md`](oauth.md) §4 를 따른다.
- **Google Cloud 콘솔 승인된 리다이렉트 URI**(로컬 클라이언트 `prami-dev`에 2개 모두 등록 — dev 스크립트가 `--hostname 127.0.0.1` 로 바인딩):
  - `http://localhost:3000/api/auth/callback/google`
  - `http://127.0.0.1:3000/api/auth/callback/google`
- **브라우저 접속 주소는 `http://localhost:3000`** 으로 통일한다(`AUTH_URL` 과 같은 호스트여야 세션 쿠키·콜백이 맞는다).
- 코드 변경은 없다: Google 공급자는 `AUTH_GOOGLE_ID`·`AUTH_GOOGLE_SECRET` 이 있으면 등록되고, 테스트 Credentials 공급자는 `AUTH_TEST_MODE` 가 없으면 등록되지 않는다.
  E2E `tests/e2e/local-real-login.spec.ts` 가 T-1 설정(더미 클라이언트 값, 테스트 모드 키 없음)의 `/login`·`/api/auth/providers` 를 검사한다(AC-335).
- T-1 이후 `AUTH_TEST_MODE` 를 지운 :3000 을 대상으로 E2E 를 돌리지 않는다(E2E 는 자체 서버·격리 DB 를 쓴다).

### T-1 `.env.local` 키 점검표 (이름만)

| 키 | T-1 상태 |
| --- | --- |
| `DB_DRIVER`, `DATABASE_URL` | 그대로 (`pg`, 로컬 docker) |
| `AUTH_SECRET` | 그대로 |
| `AUTH_URL`, `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | `prami-dev` 클라이언트 값 (저장소·문서·PR 에 쓰지 않는다) |
| `ALLOWED_EMAIL_DOMAINS` | `pentasecurity.com` |
| `ADMIN_EMAILS` | 실제 관리자 이메일(UP-7) — fixture 이메일 금지 |
| `AUTH_REQUIRE_HD` | `true` (PR-3 머지 후) |
| `AUTH_TEST_MODE`, `AUTH_TEST_PASSWORD`, `AUTH_TEST_ALLOWED_HOSTS`, `AUTH_TEST_MODE_ALLOW_REMOTE` | **삭제** |
| `PRAMI_ALLOW_SEED` | **두지 않는다** |
| `LLM_CREDENTIALS_KEKS`, `LLM_CREDENTIALS_ACTIVE_KEK` | 그대로 (재구성 후 사용자 LLM 키는 다시 등록) |

## 2. 로컬 :3000 DB 재구성 (§4.9.6, Main 실행)

- 실행 시점: PR-2 가 `integration/prami-003` 에 머지되고 :3000 워크트리가 그 커밋 이상일 때(`data:verify`·seed 가드 필요).
- 대상: 컨테이너 `prami-postgres-1`, DB `prami`, 사용자 `prami`(docker-compose 기본값). 다르면 `.env.local` 의 `DATABASE_URL` 에 맞춘다.
- PowerShell 에서 **직접 입력**하거나, `.ps1` 로 저장할 때는 **UTF-8(BOM 있음)** 으로 저장한다 — Windows PowerShell 5.1 은 BOM 없는 UTF-8 스크립트를
  ANSI 로 읽어 한글 파일명(`병합_가격_raw.xlsx` 등)이 깨진다(리허설에서 확인).

```powershell
# 0) 준비 — :3000 dev 서버를 Main 관리 터미널에서 중지한다(DB 연결이 남아 있으면 DROP 실패)
$app   = '<:3000 이 서빙하는 워크트리 경로>'
$inp   = 'C:\Users\USER\orca\workspaces\Prami\_inputs'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$bak   = 'C:\Users\USER\orca\backups'
New-Item -ItemType Directory -Force $bak | Out-Null

# 1) 백업 — 컨테이너 안에서 덤프 후 꺼낸다(PowerShell 리다이렉트는 바이너리를 깨므로 쓰지 않는다)
docker exec prami-postgres-1 pg_dump -U prami -d prami -Fc -f "/tmp/prami-$stamp.dump"
docker cp "prami-postgres-1:/tmp/prami-$stamp.dump" "$bak\prami-local-$stamp.dump"
docker exec prami-postgres-1 pg_restore --list "/tmp/prami-$stamp.dump" | Select-Object -First 5
docker exec prami-postgres-1 psql -U prami -d prami -At -c "select 'items', count(*) from items union all select 'audit_logs', count(*) from audit_logs"

# 2) 드롭·재생성
docker exec prami-postgres-1 psql -U prami -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE prami WITH (FORCE);"
docker exec prami-postgres-1 psql -U prami -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE prami OWNER prami;"

# 3) migrate (S-2) — :3000 워크트리의 .env.local(DB_DRIVER=pg, DATABASE_URL=로컬)을 그대로 쓴다
Set-Location $app
pnpm db:migrate
pnpm data:verify --stage schema --target local

# 4) .env.local 점검 — ADMIN_EMAILS = 실제 관리자 이메일(UP-7 전에는 운영자 본인), fixture 이메일 없음,
#    PRAMI_ALLOW_SEED 없음. seed 는 실행하지 않는다(실행해도 PRAMI_ALLOW_SEED 가 없으면 거부된다).

# 5) 임포트 (S-4 ~ S-6) — 정식 서비스 경로, 순서 고정(판매단가 → 품목 → 원가)
pnpm import:source "$inp\PRAMI-001\병합_가격_raw.xlsx" --kind sales
pnpm import:source "$inp\PRAMI-003\WAPPLES 품목.xlsx" "$inp\PRAMI-003\D'AMO 품목.xlsx" "$inp\PRAMI-003\iSIGN 품목.xlsx" "$inp\PRAMI-003\iSGIN PKI 품목.xlsx" "$inp\PRAMI-003\cloudbric 품목.xlsx" --kind items
pnpm import:source "$inp\PRAMI-001\원자재코드 정보_260825.xlsx" --kind costs

# 6) 검증 (S-7) — exit 0 이어야 한다. 로그인 전이라 "활성 ADMIN" 은 SKIP 으로 나온다
pnpm data:verify --fresh --target local

# 7) dev 서버 재시작 → 관리자 이메일로 로그인(T-0 또는 T-1) → /pricing·/calculator·/admin/policies 확인
#    로그인 후 한 번 더(이번에는 활성 ADMIN ≥ 1 이 PASS 여야 한다):
pnpm data:verify --fresh --target local

# 8) 컨테이너 안 임시 덤프 삭제(호스트 사본은 보존)
docker exec prami-postgres-1 rm "/tmp/prami-$stamp.dump"
```

- **복원**(재구성 실패·되돌리기): 2)처럼 드롭·재생성 →
  `docker cp "$bak\prami-local-<stamp>.dump" prami-postgres-1:/tmp/restore.dump` →
  `docker exec prami-postgres-1 pg_restore -U prami -d prami --no-owner /tmp/restore.dump`.
- 실패 시: 원인을 고친 뒤 **2)부터 다시**(부분 재시도 금지 — 배치 이력이 섞인다, §4.9.1 S-7).
- 재구성 후 :3000 에서 보이는 변화: 공지·견적·솔루션 그룹이 비고, 파츠 매핑이 없어 계산기 STEP4 는 대분류 전체 파츠를 보이며,
  사용자 LLM 키가 없다(관리자가 회사 키를 다시 등록 — 설정 화면 주의 문구 참고).

### `data:verify` 요약 (§4.9.2)

| 옵션 | 의미 |
| --- | --- |
| `--target local\|preview\|production` | 원격(`preview`·`production`)은 `--target-host <연결 호스트>` 가 실제 호스트와 같아야 실행. `local` 도 DB 가 원격이면 같은 규칙 |
| `--stage schema\|data` | `schema` = 저널 최신 = DB 최신·마이그레이션 10행(`0000`~`0009`). 기본 `data` |
| `--fresh` | 클린 설치 직후용: fixture 계정 0, 공지·견적·공유·솔루션 그룹·LLM 키·OAuth state 0, part_mappings 0, 감사 actor `seed` 0, 적용 배치 종류별 1, 허용 도메인 밖 사용자 0, 활성 ADMIN ≥ 1(로컬은 로그인 전이면 SKIP) |
| `--allow-part-mappings` | 관리자가 파츠 매핑을 넣은 뒤 — 매핑 수만 출력 |
| exit | 0 통과 · 1 실패 · 2 원본 SHA-256 이 기준과 다름(수치는 실측만 출력 — Plan 기준값 재계산 필요) |

읽기 전용(READ ONLY 트랜잭션, SELECT 만)이고 출력은 개수·라벨만이다(이메일·이름·품명·금액 없음).

### 파츠 매핑 초안 (§4.9.5, 선택)

`pnpm parts:draft --out <저장소 밖 폴더>` → `parts-draft-<YYYYMMDD>.xlsx`(시트 1 `/admin/parts` 등록 2컬럼, 시트 2 검수, 시트 3 근거 없음).
DB 를 바꾸지 않는다. 관리자가 시트 2 로 검수하고 필요한 행만 남긴 시트 1 을 `/admin/parts` 엑셀 등록(미리보기 → 적용)으로 넣는다.
넣은 뒤에는 `data:verify --fresh --allow-part-mappings`. 빈 상태여도 계산기 STEP4 는 같은 대분류 파츠 전체를 보인다.

## 3. 감사 로그 보존 (§4.9.7)

| 환경 | 정책 |
| --- | --- |
| production | append-only, 최소 3년 DB 보존, 분기 CSV 보관. 삭제·잘라내기 금지. 클린 설치는 **첫 배포 전 1회만** |
| preview | 공용 preview 브랜치 재생성 시 함께 사라진다(QA 데이터). 보존 의무 없음 |
| 로컬 :3000 | 재구성 시 기존 감사 행은 **백업 덤프에만 보존**. 새 DB 는 빈 감사 로그로 시작해 임포트·로그인부터 기록. 덤프는 `C:\Users\USER\orca\backups\` 에 PR-5(운영 배포) 완료까지 보존 후 Main 이 삭제. 덤프에는 사용자 이메일·LLM 키 암호문이 있으므로 저장소·공유 폴더에 올리지 않는다 |

## 4. `ADMIN_EMAILS` 부트스트랩과 첫 관리자 로그인 (§4.9.8)

1. 사용자(UP-7)가 첫 관리자 이메일 1명 이상(+예비 1명 권장)을 Main 에 준다. Main 이 Vercel env(production·preview)와 로컬 `.env.local` 에 넣는다.
   값은 저장소·PR 본문에 쓰지 않는다(체크리스트에는 "설정됨·개수"만).
2. production 기동 검사 ⓖ 가 빈 값을 거부한다(preview 는 경고).
3. 첫 로그인: 로그인 정책이 허용 도메인 계정을 자동 생성하고, `ADMIN_EMAILS` 에 있으면 ADMIN 으로 만든다(감사 `auth.login`).
   운영·preview 에서는 `fixture-` 로 시작하는 이메일은 거부된다(감사 `auth.denied_domain`, 사유 `fixture_account`).
4. 관리자가 판매단가 → 품목 → 원가를 화면에서 적용한다(production·preview). 감사 actor = 이 관리자.
5. 관리자가 `/admin/users` 에서 다른 사용자 역할을 관리한다. 이후 `ADMIN_EMAILS` 는 비상 복구용으로 유지(빈 값이면 production 기동 거부).
6. 확인: `data:verify --fresh` 의 활성 ADMIN ≥ 1·fixture 0.

## 5. 리허설 기록 (AC-337, Dev — 격리 컨테이너)

2026-10-01, 컨테이너 `prami-qa-rehearsal`(postgres:16, :55433, `prami-postgres-1`·:3000 미접촉)에서 위 PowerShell 절차를 컨테이너 이름만 바꿔 실행했다.
사전 상태는 현재 로컬과 같은 모양(migrate → seed → 원본 3종 적용, `fixture-*` 2명·공지 3건·감사 8행)으로 만들었다.

| 단계 | 결과 |
| --- | --- |
| 1) 백업 | `pg_dump -Fc` 성공, `pg_restore --list` 정상(TOC 181), 덤프 약 360KB |
| 2) 드롭·재생성 | 성공 |
| 3) migrate + `data:verify --stage schema` | `0000`~`0007` 8행, exit 0 |
| 5) 임포트 | 판매단가 → 품목 5파일 → 원가 모두 exit 0 |
| 6) `data:verify --fresh --target local` | exit 0 — PASS 31 / SKIP 1(활성 ADMIN, 로그인 전) |
| 대체 검증 SQL | items_master 2511 · items_stub 0 · sales_rows 5885 · sales_operating 2428 · sales_unused 3457 · costs_rows 487 · fixture_users 0 · notices 0 · quotes 0 · solution_groups 0 · part_mappings 0 · seed_audit 0 — `data:verify` 와 동일 |
| 8) 임시 덤프 삭제 | 성공 |
| 복원 | 드롭·재생성 → `pg_restore --no-owner` → items 2511 · audit_logs 8 · users 2 · notices 3(사전 상태와 동일) |

> **#31 이후 기대값:** 위 기록은 2026-10-01(마이그레이션 `0007` 까지) 기준이다. `0008_notifications` 부터 3) 은 `0000`~`0008` 9행, 6) `data:verify --fresh --target local` 은 **PASS 32 / SKIP 1**(`notifications 행 = 0` 검사 추가)이다. 사용자 행위자가 없는 스크립트 적용(`import:source`)은 알림을 만들지 않으므로 5) 임포트 뒤에도 `notifications` 는 0 이다. `0009_cost_item_links`(원가 매핑) 부터 3) 은 `0000`~`0009` 10행이다(6) 의 PASS 수는 같음 — `cost_item_links` 는 fresh 검사 대상 아님).

## 6. LAN 에서 dev 서버 열기 (Linux 하이드레이션 수정 스펙 §3.2·§3.4)

다른 PC 에서 `http://<서버 주소>:3000` 으로 dev 서버에 접속하려면 바인드 주소와 **허용 dev origin** 두 가지를 함께 설정한다.
`pnpm dev` 는 `127.0.0.1` 에만 바인드하므로 LAN 노출은 항상 명시적이다. README 의 테스트 모드 LAN 경고는 그대로 유효하다 —
내부망 전용 호스트에서 의도적으로 켤 때만 아래 보완 절차를 따른다.

```bash
# .env.local (저장소에 커밋하지 않는다)
NEXT_DEV_ALLOWED_ORIGINS=192.168.1.156          # 브라우저가 접속하는 "서버 주소의 hostname" (접속자 IP 아님). 여러 개면 쉼표
AUTH_TEST_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.156   # 테스트 로그인을 받을 Host (기본 localhost,127.0.0.1)
AUTH_TEST_PASSWORD=<강한 비밀번호>              # LAN 에 열면 같은 망의 누구나 시도할 수 있다

pnpm dev:lan                                    # next dev --hostname 0.0.0.0
```

- `NEXT_DEV_ALLOWED_ORIGINS` 는 `next.config.ts` 의 `allowedDevOrigins` 로 들어간다. dev 전용 설정이라 `src/env.ts` 스키마·`.env.example`·`docs/deploy/vercel.md` 표에는 두지 않는다(`NEXT_DIST_DIR` 과 같은 취급). `next build`/`next start` 에는 영향이 없다.
- 미설정 시 증상: 서버 로그에 `Blocked cross-origin request to Next.js dev resource …`, 브라우저 콘솔에 HMR 웹소켓 오류, dev 오류 오버레이의 스택프레임 요청이 403. 페이지 자체는 렌더되지만 수정 사항이 자동 반영되지 않는다.
- `src/proxy.ts` matcher 는 손대지 않는다 — HMR 업그레이드(`/_next/hmr`)와 `/__nextjs_*` 는 Next 가 proxy 이전에 처리하므로 제외할 필요가 없다.
- 확인: 네트워크 탭 `/_next/hmr` 가 101 Switching Protocols, 콘솔 `[HMR] connected`, 서버 로그에 `Blocked cross-origin request` 0건 (localhost·LAN 양쪽).
