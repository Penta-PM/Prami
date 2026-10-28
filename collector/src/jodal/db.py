"""조달이 수집기 → Prami DB(procurement 스키마) 직접 기록 — 매일 수집 · 입찰공고 반영.

  jodal daily   등록물품 수집 → items, 납품요구 수집 → deliveries, 보고 메일(수신처 = mail_recipients)
  jodal bids    입찰공고 → bid_notices

접속 주소는 환경변수 COLLECTOR_DATABASE_URL. search_path 를 procurement 로 맞춰 SQL 은 스키마 접두어 없이 쓴다.
Prami 화면은 같은 DB를 실시간으로 읽는다. 사람이 화면에서 정한 것(제품 지정·제외·확인)은 건드리지 않는다.
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .settings import now_kst, required_env, today_kst

SCHEMA = "procurement"
# 일일 보고 메일 결과 (job_runs.summary.mail — Prami 상태 카드가 읽는 값, 스펙 §2.4)
MAIL_SENT = "sent"
MAIL_SKIPPED_NO_RECIPIENTS = "skipped_no_recipients"
MAIL_SKIPPED_NO_SMTP = "skipped_no_smtp"
MAIL_FAILED = "failed"


def database_url() -> str:
    return required_env("COLLECTOR_DATABASE_URL")


def connect():
    """COLLECTOR_DATABASE_URL 로 접속. 주소의 options 에 search_path 가 없으면 procurement 로 붙인다."""
    import psycopg
    from psycopg.conninfo import conninfo_to_dict

    params = conninfo_to_dict(database_url())
    options = str(params.get("options") or "")
    if "search_path" not in options:
        params["options"] = f"{options} -csearch_path={SCHEMA}".strip()
    params.setdefault("connect_timeout", 30)
    return psycopg.connect(**params)


# ── 값 변환 (시트 문자열 → DB 칸) ─────────────────────────────
def to_date(v) -> date | None:
    m = re.match(r"(\d{4})[-./]?(\d{2})[-./]?(\d{2})", str(v or "").strip())
    return date(int(m[1]), int(m[2]), int(m[3])) if m else None


def to_int(v) -> int | None:
    v = str(v or "").replace(",", "").strip()
    try:
        return int(float(v)) if v else None
    except ValueError:
        return None


def to_num(v):
    v = str(v or "").replace(",", "").strip()
    try:
        return float(v) if v else None
    except ValueError:
        return None


def to_text(v) -> str | None:
    v = str(v or "").strip()
    return v or None


def to_kst(v) -> datetime | None:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?", str(v or ""))
    if not m:
        return None
    return datetime.fromisoformat(f"{m[1]}-{m[2]}-{m[3]}T{m[4] or '00'}:{m[5] or '00'}:00+09:00")


# 납품요구: 시트 열 이름 → (DB 칸, 변환)
DLVR_COLS = {
    "dlvr_req_no": ("납품요구번호", to_text),
    "item_id": ("물품식별번호", to_text),
    "change_ord": ("납품요구변경차수", to_text),
    "dlvr_req_date": ("납품요구일자", to_date),
    "demand_org": ("수요기관", to_text),
    "demand_org_type": ("수요기관유형", to_text),
    "business_name": ("사업명", to_text),
    "contract_no": ("계약번호", to_text),
    "contract_type": ("계약종류", to_text),
    "vendor": ("납품업체명", to_text),
    "vendor_type": ("납품업체구분", to_text),
    "vendor_address": ("납품업체소재지", to_text),
    "procurement_office": ("담당조달청", to_text),
    "class_code": ("물품분류코드", to_text),
    "class_name": ("물품분류명", to_text),
    "item_name": ("물품식별명", to_text),
    "due_date": ("납품기한일자", to_date),
    "unit_price": ("계약단가", to_int),
    "unit": ("단위", to_text),
    "quantity": ("납품수량", to_num),
    "amount": ("납품금액", to_int),
    "total_amount": ("납품요구총금액", to_int),
    "collected_on": ("조회일자", to_date),
}


def delivery_values(raw: dict) -> tuple:
    """시트 열 이름으로 된 납품요구 한 줄 → insert 값 (DLVR_COLS 순서 + raw)."""
    from psycopg.types.json import Jsonb

    raw = dict(raw)
    raw["납품요구변경차수"] = str(raw.get("납품요구변경차수") or "").strip() or "00"
    return tuple(f(raw.get(col)) for col, f in DLVR_COLS.values()) + (Jsonb(raw),)


DLVR_INSERT = (
    f"insert into deliveries ({', '.join(DLVR_COLS)}, raw) values ({', '.join(['%s'] * (len(DLVR_COLS) + 1))})"
)


# ── 상태 · 실행 기록 ─────────────────────────────
def get_state(conn, key: str) -> dict:
    row = conn.execute("select value from app_state where key = %s", (key,)).fetchone()
    return row[0] if row else {}


def set_state(conn, key: str, value: dict) -> None:
    from psycopg.types.json import Jsonb

    conn.execute(
        "insert into app_state (key, value) values (%s, %s) "
        "on conflict (key) do update set value = excluded.value, updated_at = now()",
        (key, Jsonb(value)),
    )


class JobRun:
    """job_runs에 시작·종료를 남긴다 (대시보드·점검용)."""

    def __init__(self, conn, job: str):
        self.conn, self.job = conn, job
        self.id = conn.execute("insert into job_runs (job) values (%s) returning id", (job,)).fetchone()[0]
        conn.commit()

    def finish(self, ok: bool, summary: dict) -> None:
        from psycopg.types.json import Jsonb

        self.conn.rollback()  # 실패한 트랜잭션이 남아 있으면 정리
        self.conn.execute(
            "update job_runs set finished_at = now(), status = %s, summary = %s where id = %s",
            ("ok" if ok else "failed", Jsonb(summary), self.id),
        )
        self.conn.commit()


# ── 매일 수집 ─────────────────────────────
# item_changes 의 before/after 는 바뀐 칸만, DB 열 이름으로 (Prami 품목 편집과 같은 모양 — item-mutations.ts)
_SNAPSHOT_COLS = ("item_id", "product", "detail_category", "manufacturer", "item_name", "status", "reviewed")
SYSTEM_ACTOR = "system"


def _promote_etc(conn, vals: dict) -> None:
    """검토 대기 중인 '기타' 줄을 제품으로 올리고, 같은 트랜잭션에서 item_changes 에 system 이력 1행을 남긴다."""
    from psycopg.types.json import Jsonb

    cols = ", ".join(_SNAPSHOT_COLS)
    before = conn.execute(
        f"select id, {cols} from items where item_id = %(item_id)s and product = '기타' and status = 'pending' "
        "for update",
        vals,
    ).fetchone()
    if not before:
        return
    after = conn.execute(
        "update items set product = %(product)s, detail_category = %(detail_category)s, status = 'active' "
        f"where id = %(id)s returning {cols}",
        {**vals, "id": before[0]},
    ).fetchone()
    old, new = dict(zip(_SNAPSHOT_COLS, before[1:])), dict(zip(_SNAPSHOT_COLS, after))
    changed = [c for c in _SNAPSHOT_COLS if old[c] != new[c]]
    if not changed:
        return
    conn.execute(
        "insert into item_changes (item_pk, action, before, after, changed_by) values (%s, 'edit', %s, %s, %s)",
        (before[0], Jsonb({c: old[c] for c in changed}), Jsonb({c: new[c] for c in changed}), SYSTEM_ACTOR),
    )


def _new_items(conn, records, sections, detail_by_key, end_date: date) -> list[dict]:
    """수집한 등록물품을 items에 넣는다. 처음 보는 것만 넣고, 넣은 것을 메일용 dict로 돌려준다.

    - 제품으로 분류된 것: active + 확인 전(reviewed=false) → 대시보드 "일일 신규 품목"에 뜬다
    - 분류 안 된 것(기타): pending + 확인 전 → 사람이 제품을 고르거나 삭제
    - 기타로 들어왔다가 나중에 제품으로 분류되면, 아직 검토 대기인 기타 줄을 그 제품으로 바꾼다
    """
    known: set[tuple[str, str]] = set()
    pending_etc: set[str] = set()
    for iid, prod, status in conn.execute("select item_id, product, status from items").fetchall():
        known.add((iid, prod))
        if prod == "기타" and status == "pending":
            pending_etc.add(iid)
    known_ids = {iid for iid, _ in known}

    labels_by_hash: dict[str, list[str]] = {}
    for pname, rows in (sections or {}).items():
        if pname == "기타":
            continue
        for r in rows:
            labels_by_hash.setdefault(r.source_row_hash, []).append(pname)

    added: list[dict] = []
    for r in records:
        iid = (r.item_id or "").strip()
        if not iid:
            continue
        for label in labels_by_hash.get(r.source_row_hash) or ["기타"]:
            if (iid, label) in known or (label == "기타" and iid in known_ids):
                continue
            detail = (detail_by_key or {}).get((iid, label), "") or None
            vals = dict(
                item_id=iid,
                product=label,
                detail_category=detail,
                manufacturer=to_text(r.manufacturer_name),
                item_name=to_text(r.item_specification),
                registered_on=r.input_date,
                collected_on=end_date,
                status="pending" if label == "기타" else "active",
            )
            if label != "기타" and iid in pending_etc:
                _promote_etc(conn, vals)
                pending_etc.discard(iid)
            else:
                conn.execute(
                    "insert into items (item_id, product, detail_category, manufacturer, item_name, registered_on,"
                    " collected_on, status, reviewed) values (%(item_id)s, %(product)s, %(detail_category)s,"
                    " %(manufacturer)s, %(item_name)s, %(registered_on)s, %(collected_on)s, %(status)s, false)"
                    " on conflict (item_id, product) do nothing",
                    vals,
                )
            known.add((iid, label))
            known_ids.add(iid)
            added.append(
                {
                    "제품명": label,
                    "제조사명": r.manufacturer_name or "",
                    "물품식별번호": iid,
                    "품목": r.item_specification or "",
                    "등록일자": r.input_date.isoformat() if r.input_date else "",
                }
            )
    return added


def _new_deliveries(conn, dlvr_results: list[dict]) -> dict[str, list[dict]]:
    """수집한 납품요구 중 처음 보는 것만 deliveries에 넣는다. 반환: 제품별 새 납품요구(원본 dict)."""
    from .delivery_rows import _DLVR_HEADERS, _delivery_row

    today = today_kst().isoformat()
    product_of: dict[str, list[str]] = {}
    for iid, prod in conn.execute(
        "select item_id, product from items where status = 'active' and product <> '기타'"
    ).fetchall():
        product_of.setdefault(iid, []).append(prod)

    new: dict[str, list[dict]] = {}
    for dr in dlvr_results:
        raw = dict(zip(_DLVR_HEADERS, _delivery_row(dr, today)))
        row = conn.execute(
            DLVR_INSERT + " on conflict (dlvr_req_no, item_id, change_ord) do nothing returning item_id",
            delivery_values(raw),
        ).fetchone()
        if row:
            for prod in product_of.get(row[0], []):
                new.setdefault(prod, []).append(dr)
    return new


def market_share_stats(conn, as_of: date) -> dict[str, dict]:
    """제품별·iSIGN 세부 그룹별 자사 점유율/순위 (DB 칸 기준)."""
    from .delivery_rows import _DLVR_HEADERS, _share_stats_from_delivery_rows

    mfr: dict[str, dict[str, str]] = {}
    group_of: dict[str, str] = {}
    for iid, prod, maker, grp in conn.execute(
        "select item_id, product, manufacturer, product_group from items where status = 'active' and product <> '기타'"
    ).fetchall():
        if maker:
            mfr.setdefault(prod, {})[iid] = maker
        if prod == "iSIGN" and grp:
            group_of[iid] = grp

    # 원본(raw)이 아니라 DB 칸에서 만든다 — 대시보드 "조달 실적 현황 관리"에서 고친 값이 바로 반영되게
    rows_by: dict[str, list[list[str]]] = {}
    idx = {h: i for i, h in enumerate(_DLVR_HEADERS)}
    for prod, grp, ddate, iid, vendor, amount in conn.execute(
        "select product, product_group, dlvr_req_date, item_id, vendor, amount from v_product_deliveries"
    ).fetchall():
        line = [""] * len(_DLVR_HEADERS)
        line[idx["납품요구일자"]] = ddate.strftime("%Y%m%d") if ddate else ""
        line[idx["물품식별번호"]] = iid or ""
        line[idx["납품업체명"]] = vendor or ""
        line[idx["납품금액"]] = str(amount or 0)
        rows_by.setdefault(prod, []).append(line)
        if prod == "iSIGN" and grp:
            rows_by.setdefault(f"iSIGN · {grp}", []).append(line)

    stats: dict[str, dict] = {}
    for key, rows in rows_by.items():
        if key.startswith("iSIGN · "):
            g = key.split(" · ", 1)[1]
            mmap = {i: m for i, m in mfr.get("iSIGN", {}).items() if group_of.get(i) == g}
        else:
            mmap = mfr.get(key, {})
        share = _share_stats_from_delivery_rows([list(_DLVR_HEADERS)] + rows, mmap, as_of=as_of)
        if share:
            stats[key] = share
    return stats


def mail_recipients(conn) -> list[str]:
    """보고 메일 수신처 (Prami "메일 보고" 탭이 관리하는 procurement.mail_recipients)."""
    return [r[0] for r in conn.execute("select email from mail_recipients order by id").fetchall()]


def smtp_settings() -> dict | None:
    """SMTP 설정 (원본과 같은 환경변수). 사용자·비밀번호가 없으면 None — 메일을 보내지 않는다."""
    user, pw = os.environ.get("JODAL_SMTP_USER", "").strip(), os.environ.get("JODAL_SMTP_PASSWORD", "")
    if not user or not pw:
        return None
    return {
        "smtp_user": user,
        "smtp_password": pw,
        "smtp_host": os.environ.get("JODAL_SMTP_HOST") or "smtp.gmail.com",
        "smtp_port": int(os.environ.get("JODAL_SMTP_PORT") or 587),
    }


def send_daily_report(
    conn, summary: dict, *, end_date: date, period_start: date, new_items: list[dict], new_dlvr: dict[str, list[dict]]
) -> None:
    """보고 메일 한 통 (수신자 Bcc). 결과를 summary.mail·mail_recipient_count 에 남긴다 — 주소·본문은 남기지 않는다.
    발송 실패는 예외로 올린다 (원본처럼 이 실행을 실패로 끝내고 보고 기준일을 저장하지 않는다)."""
    recipients = mail_recipients(conn)
    summary["mail_recipient_count"] = len(recipients)
    if not recipients:
        summary["mail"] = MAIL_SKIPPED_NO_RECIPIENTS
        print("[DB] 메일 건너뜀: 수신처 없음 (Prami 조달 관리 > 메일 보고)", flush=True)
        return
    smtp = smtp_settings()
    if smtp is None:
        summary["mail"] = MAIL_SKIPPED_NO_SMTP
        print("[DB] 메일 건너뜀: JODAL_SMTP_USER / JODAL_SMTP_PASSWORD 없음", flush=True)
        return
    from .notifier import send_report_email

    today_items: dict[str, list[dict]] = {}
    for a in new_items:
        today_items.setdefault(a["제품명"], []).append(
            {
                "manufacturer": a["제조사명"],
                "item_id": a["물품식별번호"],
                "desc": a["품목"],
                "reg_date": a["등록일자"],
            }
        )
    cumulative = dict(
        conn.execute(
            "select product, count(*) from items where status = 'active' and product <> '기타' group by product"
        ).fetchall()
    )
    try:
        send_report_email(
            end_date=end_date,
            period_start=period_start,
            new_deliveries=new_dlvr,
            today_items=today_items,
            cumulative_counts=cumulative,
            market_share_stats=market_share_stats(conn, end_date),
            bcc_addresses=recipients,
            dashboard_url=os.environ.get("JODAL_DASHBOARD_URL") or None,
            **smtp,
        )
    except Exception as e:
        summary["mail"] = MAIL_FAILED
        # 예외 메시지에는 주소가 들어갈 수 있어(SMTPRecipientsRefused 등) 종류만 남긴다
        raise RuntimeError(f"메일 발송 실패: {type(e).__name__}") from e
    summary["mail"] = MAIL_SENT
    print(f"[DB] 메일 발송 → 수신처 {len(recipients)}명 (Bcc)", flush=True)


def run_daily(
    *,
    end_date: date,
    headed: bool,
    no_email: bool,
    filter_file: Path,
    products_file: Path,
    read_rows,
    output_dir: Path,
    skip_if_done: bool = False,
) -> None:
    from .collector import download_report_xlsx
    from .filter_config import load_classification_name_filter, load_product_filter
    from .g2b_dlvr import fetch_delivery_portal
    from .reference import load_damo_competitors
    from .transform import classify_by_product, filter_by_classification_names

    conn = connect()
    if skip_if_done:
        last = get_state(conn, "daily").get("last_end_date")
        if last and date.fromisoformat(last) >= end_date:
            print(f"[DB] {end_date} 보고는 이미 끝났습니다 — 건너뜀", flush=True)
            conn.close()
            return
    job = JobRun(conn, "daily")
    summary: dict[str, Any] = {"end_date": end_date.isoformat()}
    try:
        # 지난 보고 이후 놓친 기간(주말·휴일·실패)까지 함께 본다
        last = get_state(conn, "daily").get("last_end_date")
        last_end = date.fromisoformat(last) if last else None
        period_start = end_date
        if last_end and last_end < end_date:
            period_start = max(last_end + timedelta(days=1), end_date - timedelta(days=90))
        start_date = min(end_date - timedelta(days=6), period_start)
        summary["period_start"] = period_start.isoformat()
        print(f"[DB] 조회 기간 {start_date} ~ {end_date} (보고 기간 {period_start} ~ {end_date})", flush=True)

        # 1) 등록물품
        xlsx = download_report_xlsx(
            destination=output_dir / "downloads" / f"g2b_items_{start_date}_to_{end_date}.xlsx",
            start_date=start_date,
            end_date=end_date,
            headed=headed,
        )
        name_filter = load_classification_name_filter(filter_file)
        records = filter_by_classification_names(
            read_rows(xlsx), name_filter.names, codes=name_filter.codes, date_from=start_date, date_to=end_date
        )
        sections, detail_by_key = classify_by_product(
            records, load_product_filter(products_file), damo_competitors=load_damo_competitors()
        )
        new_items = _new_items(conn, records, sections, detail_by_key, end_date)
        conn.commit()
        by_label: dict[str, int] = {}
        for a in new_items:
            by_label[a["제품명"]] = by_label.get(a["제품명"], 0) + 1
        summary["new_items"] = by_label
        print(f"[DB] 등록물품 {len(records)}건 중 새 물품 {len(new_items)}건 {by_label}", flush=True)

        # 2) 납품요구 (등록 물품 전체 대상, 어제까지)
        ids = {
            r[0]
            for r in conn.execute("select item_id from items where status = 'active' and product <> '기타'").fetchall()
        }
        dlvr_end = end_date - timedelta(days=1)
        dlvr_start = min(dlvr_end - timedelta(days=6), period_start - timedelta(days=1))
        print(f"[DB] 납품요구 조회 {dlvr_start} ~ {dlvr_end} ({len(ids)}개 물품식별번호)", flush=True)
        dlvr = fetch_delivery_portal(item_ids=ids, start_date=dlvr_start, end_date=dlvr_end, headed=headed)
        new_dlvr = _new_deliveries(conn, dlvr)
        conn.commit()
        summary["new_deliveries"] = {k: len(v) for k, v in new_dlvr.items()}
        print(f"[DB] 납품요구 {len(dlvr)}건 조회 · 새로 들어온 건 {summary['new_deliveries']}", flush=True)

        # 3) 메일 (--no-email 이면 보내지 않고 summary.mail 도 남기지 않는다)
        if not no_email:
            send_daily_report(
                conn, summary, end_date=end_date, period_start=period_start, new_items=new_items, new_dlvr=new_dlvr
            )

        # 보고 기준일은 발송 뒤에 저장 (원본과 같음 — 발송이 실패하면 다음 실행이 빠진 기간까지 함께 보낸다)
        # last_run 은 원본 형식 그대로 시간대 없는 시각 — 프로세스 TZ 와 무관하게 한국 시각으로 적는다
        if not last_end or end_date > last_end:
            set_state(
                conn,
                "daily",
                {"last_end_date": end_date.isoformat(), "last_run": now_kst().replace(tzinfo=None).isoformat()},
            )
        conn.commit()
        job.finish(True, summary)
    except BaseException as e:
        summary["error"] = f"{type(e).__name__}: {e}"
        job.finish(False, summary)
        raise
    finally:
        conn.close()


# ── 입찰공고 ─────────────────────────────
def load_bid_rules():
    """DB의 분류 키워드(대시보드 "입찰 공고 키워드 관리") → (KeywordRules, 지난 확인 이후 새로 추가된 키워드가 있는지)."""
    from .g2b_bid import KeywordRules

    conn = connect()
    try:
        kw: dict[str, list[str]] = {}
        newest = None
        for prod, k, at in conn.execute("select product, keyword, created_at from bid_keywords order by id").fetchall():
            kw.setdefault(prod, []).append(k)
            newest = at if newest is None or at > newest else newest
        last = get_state(conn, "bids").get("last_checked")
        has_new = bool(newest and last and newest > datetime.fromisoformat(last))
        return KeywordRules(kw), has_new
    finally:
        conn.close()


def reclassify_bids(conn, rules) -> int:
    """키워드가 바뀌면 이미 모은 공고도 다시 판정한다. 더는 안 걸리는 공고는 지우지 않고 관련 제품을 비운다(화면에서 숨김)."""
    changed = 0
    for bid_no, title, prods, kws in conn.execute(
        "select bid_no, title, products, keywords from bid_notices"
    ).fetchall():
        p, k = rules.classify(title)
        k = list(dict.fromkeys(k))
        if p != list(prods or []) or k != list(kws or []):
            conn.execute("update bid_notices set products = %s, keywords = %s where bid_no = %s", (p, k, bid_no))
            changed += 1
    return changed


# ── 입찰공고 적합도 (규칙 기반) ─────────────────────────────
# 공고명·업무구분·예산·마감·수요기관 납품 이력으로 우리 제품 영업에 맞는 공고인지 점수(0~100)와 근거를 낸다.
# 상 70 이상 / 중 45 이상 / 하 그 아래. 근거는 화면에 그대로 보이므로 짧은 우리말로 쓴다.
_FIT_BUY = re.compile(r"구매|구입|도입|교체|업그레이드|구축|고도화|증설|확충|라이선스|라이센스|임차|재구축")
_FIT_MAINT = re.compile(r"유지\s*보수|유지\s*관리|기술\s*지원")
# "적격심사"·"사업자 선정"은 낙찰 방식·업체 선정이라 감점하지 않는다 (평가기관 선정은 "평가"로 걸림)
_FIT_HARD_NO = re.compile(r"연구|평가|데이터\s*셋|(?<!적격)심사|교육|행사|조사|공모|세미나|인증\s*획득")
_FIT_SOFT_NO = re.compile(r"검사|점검|진단|컨설팅|감리")
_FIT_DEV = re.compile(r"개발")


def _won(v: int) -> str:
    return f"{v / 1e8:.1f}억" if v >= 1e8 else f"{v / 1e4:,.0f}만"


def bid_fit(
    title: str,
    business_type: str | None,
    budget: int | None,
    deadline: datetime | None,
    notice_status: str | None,
    products: list[str],
    history: dict,
) -> tuple[str, int, list[str]]:
    """반환: (상/중/하, 점수, 근거 목록). history = {"ours": {제품: 건수}, "comp": {제품: 건수}} (그 수요기관 납품 이력)."""
    t = title or ""
    score, why = 50, []
    hard_no, soft_no = _FIT_HARD_NO.search(t), _FIT_SOFT_NO.search(t)
    # ① 사업 성격 — 연구·평가 같은 사업이면 "구축" 같은 단어가 있어도 제품 판매로 보지 않는다
    if hard_no:
        score -= 25
        why.append(f"－ {hard_no.group(0)} 성격 (제품 판매와 거리 있음)")
    elif soft_no:
        score -= 15
        why.append(f"－ {soft_no.group(0)} 용역 (제품 구매 아님)")
    elif m := _FIT_BUY.search(t):
        score += 20
        why.append(f"＋ 제품 {m.group(0)} 사업")
    elif _FIT_MAINT.search(t):
        score += 5
        why.append("＋ 유지보수 (기존 시스템 교체 접점)")
    if not hard_no and _FIT_DEV.search(t) and not _FIT_BUY.search(t):
        score -= 10
        why.append("－ 개발 사업 (제품 적용 여부 확인 필요)")
    # ② 업무구분
    if business_type == "물품":
        score += 10
        why.append("＋ 물품 구매")
    elif business_type == "기술용역":
        score -= 10
        why.append("－ 기술용역")
    # ③ 수요기관 납품 이력 (우리만 가진 데이터)
    ours, comp = history.get("ours", {}), history.get("comp", {})
    same_ours = sum(ours.get(p, 0) for p in products)
    same_comp = sum(comp.get(p, 0) for p in products)
    if same_ours:
        score += 15
        why.append(f"＋ 자사 기존 고객 (같은 제품 납품 {same_ours}건)")
    elif ours:
        score += 8
        why.append(f"＋ 자사 고객 ({', '.join(ours)} 납품 이력)")
    elif same_comp:
        score += 10
        why.append(f"＋ 경쟁사 고객 → 교체 기회 (납품 {same_comp}건)")
    elif comp:
        score += 5
        why.append(f"＋ 보안 제품 구매 기관 ({', '.join(comp)} 경쟁사 납품 이력)")
    # ④ 예산 (100만 원 미만은 잘못 입력된 값으로 보고 무시)
    if budget and budget >= 1_000_000:
        if budget >= 100_000_000:
            score += 10
            why.append(f"＋ 예산 {_won(budget)}")
        elif budget >= 30_000_000:
            score += 5
            why.append(f"＋ 예산 {_won(budget)}")
        elif budget < 10_000_000:
            score -= 10
            why.append(f"－ 소액 ({_won(budget)})")
    # ⑤ 마감
    if deadline:
        left = (deadline - datetime.now(deadline.tzinfo)).total_seconds() / 86400
        if 0 <= left <= 3:
            score -= 10
            why.append("－ 마감 임박 (3일 이내)")
    # ⑥ 재공고·유찰
    if re.search(r"재공고|유찰", (notice_status or "") + t):
        score += 5
        why.append("＋ 재공고·유찰 (경쟁 적을 수 있음)")
    score = max(0, min(100, score))
    grade = "상" if score >= 70 else "중" if score >= 45 else "하"
    if not why:
        why.append("특이 근거 없음 (공고 내용 확인 필요)")
    return grade, score, why


def score_bids(conn) -> int:
    """모든 입찰공고의 적합도를 다시 계산해 저장한다 (공고 수가 적어 매번 전부 계산). 반환: 바뀐 건수."""
    hist: dict[str, dict] = {}
    for org, prod, ours, n in conn.execute(
        """select d.demand_org, d.product, (i.manufacturer like '%%펜타시큐리티%%'), count(*)
           from v_product_deliveries d join items i on i.item_id = d.item_id and i.product = d.product
           where d.demand_org is not null group by 1, 2, 3"""
    ).fetchall():
        h = hist.setdefault(org, {"ours": {}, "comp": {}})
        h["ours" if ours else "comp"][prod] = n
    changed = 0
    for bid_no, title, bt, budget, dl, st, prods, demand, grade0, score0, why0 in conn.execute(
        """select bid_no, title, business_type, budget, deadline_at, notice_status, products, demand_org,
                  fit_grade, fit_score, fit_reasons from bid_notices"""
    ).fetchall():
        grade, score, why = bid_fit(title, bt, budget, dl, st, list(prods or []), hist.get(demand, {}))
        if (grade, score, why) != (grade0, score0, list(why0 or [])):
            conn.execute(
                "update bid_notices set fit_grade = %s, fit_score = %s, fit_reasons = %s where bid_no = %s",
                (grade, score, why, bid_no),
            )
            changed += 1
    return changed


def sync_bids(notices: list[dict], rules=None) -> tuple[int, int]:
    """입찰공고를 bid_notices에 반영. 새 공고는 추가, 차수·마감·상태 등이 바뀐 공고만 갱신. 반환: (추가, 갱신)."""
    from psycopg.types.json import Jsonb

    conn = connect()
    job = JobRun(conn, "bids")
    try:
        added = updated = 0
        for n in notices:
            no, _, ordv = n["공고번호"].rpartition("-")
            row = conn.execute(
                """insert into bid_notices (bid_no, bid_ord, products, title, business_type, order_org, demand_org,
                       posted_at, deadline_at, budget, est_price, notice_status, detail_url, raw, keywords)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   on conflict (bid_no) do update set
                       bid_ord = excluded.bid_ord, products = excluded.products, title = excluded.title,
                       business_type = excluded.business_type, order_org = excluded.order_org,
                       demand_org = excluded.demand_org, posted_at = excluded.posted_at,
                       deadline_at = excluded.deadline_at, budget = excluded.budget, est_price = excluded.est_price,
                       notice_status = excluded.notice_status, detail_url = excluded.detail_url,
                       raw = excluded.raw, keywords = excluded.keywords, collected_at = now()
                   where (bid_notices.bid_ord, bid_notices.products, bid_notices.title, bid_notices.deadline_at,
                          bid_notices.notice_status, bid_notices.budget, bid_notices.est_price)
                         is distinct from
                         (excluded.bid_ord, excluded.products, excluded.title, excluded.deadline_at,
                          excluded.notice_status, excluded.budget, excluded.est_price)
                   returning (xmax = 0) as inserted""",
                (
                    no,
                    ordv or "000",
                    [p.strip() for p in n["관련 제품"].split(",") if p.strip()],
                    n["공고명"],
                    to_text(n["업무구분"]),
                    to_text(n["공고기관"]),
                    to_text(n["수요기관"]),
                    to_kst(n["공고일시"]),
                    to_kst(n["입찰마감일시"]),
                    to_int(n["배정예산"]),
                    to_int(n["추정가격"]),
                    to_text(n["공고상태"]),
                    to_text(n["상세URL"]),
                    Jsonb({k: str(v) for k, v in n.items()}),
                    [k.strip() for k in n.get("키워드", "").split(",") if k.strip()],
                ),
            ).fetchone()
            if row:
                added += 1 if row[0] else 0
                updated += 0 if row[0] else 1
        reclassified = reclassify_bids(conn, rules) if rules is not None else 0
        scored = score_bids(conn)
        set_state(conn, "bids", {"last_checked": now_kst().isoformat(timespec="seconds")})
        conn.commit()
        job.finish(
            True,
            {"found": len(notices), "added": added, "updated": updated, "reclassified": reclassified, "scored": scored},
        )
        return added, updated
    except BaseException as e:
        job.finish(False, {"error": f"{type(e).__name__}: {e}"})
        raise
    finally:
        conn.close()
