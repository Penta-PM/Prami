# 운영 제약 (모든 태스크 공통)

Main `msg_5955937925fd` (2026-10-02) — Dev/QA 공통. Plan은 이후 모든 배정에 이 제약을 포함한다.

- 자기가 띄운 dev 서버만 **PID 또는 포트(:32xx 등)로 정확히** 종료한다. `pkill -f next`, `pkill -f "next dev"` 같은 넓은 패턴 **금지**.
- `:3000`과 `/home/plan1/Desktop/Prami` 경로의 프로세스는 건드리지 않는다 (사용자 실사용 경로 `http://192.168.1.156:3000`).
- `docker compose down` 등 공용 DB 컨테이너(`prami-postgres-1`) 중지 **금지** — Main 서버도 같은 DB를 쓴다.
- 포트: Main 3000 / Dev 3001 / QA 3200대.
- **GitHub 이슈·PR 댓글(사용자 지정 규칙)**: 첫 줄에 `Claude에 의하여 작성됨`을 쓰고, 빈 줄 하나를 둔 뒤 본문을 쓴다. (Main 2026-10-06)
