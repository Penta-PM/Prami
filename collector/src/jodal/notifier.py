from __future__ import annotations

import smtplib
import ssl
from datetime import date
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from .settings import SEOUL

_BADGE_COLORS = {
    "WAPPLES": "#166534",
    "D.AMO": "#1E40AF",
    "iSIGN": "#6B21A8",
    "기타": "#4B5563",
}
_DEFAULT_COLOR = "#4B5563"
_TOP_PRODUCTS = ("WAPPLES", "D.AMO", "iSIGN")
# 메일 본문에 보여줄 순서 — 제품으로 분류되지 않은 "기타"도 빠짐없이 싣고 "확인 필요"로 표시
_MAIL_SECTIONS = _TOP_PRODUCTS + ("기타",)
_NEEDS_CHECK = "확인 필요"
# 원본(조달이) 메일과 구분하는 제목 접두어 (수집기 Prami 이전 스펙 §2.3)
SUBJECT_PREFIX = "[Prami] "


def _check_pill() -> str:
    return (
        '<span style="display:inline-block;margin-left:6px;padding:3px 9px;border-radius:12px;'
        'background:#FEE2E2;color:#B91C1C;font-size:10px;font-weight:700;white-space:nowrap">'
        f"{_NEEDS_CHECK}</span>"
    )


def _badge(name: str) -> str:
    color = _BADGE_COLORS.get(name, _DEFAULT_COLOR)
    return (
        f'<span style="display:inline-block;padding:3px 10px;border-radius:12px;'
        f"background:{color};color:#fff;font-size:10px;font-weight:700;"
        f'letter-spacing:.04em;white-space:nowrap">{name}</span>'
    )


_WEEKDAYS = "월화수목금토일"


def _md(d: date) -> str:
    return f"{d.month}/{d.day}({_WEEKDAYS[d.weekday()]})"


def _period_label(period_start: date | None, end_date: date) -> str | None:
    """여러 날을 한 번에 보고할 때(주말·휴일·미발송 이후) 표시할 기간 문구. 하루면 None."""
    if period_start is None or period_start >= end_date:
        return None
    days = (end_date - period_start).days + 1
    return f"{_md(period_start)} ~ {_md(end_date)} · {days}일치"


def _fmt_ymd(v) -> str:
    v = str(v or "").strip()
    return f"{v[:4]}-{v[4:6]}-{v[6:8]}" if len(v) == 8 and v.isdigit() else (v or "-")


def _fmt_amount(v) -> str:
    try:
        return f"{int(float(str(v).replace(',', ''))):,}원"
    except (TypeError, ValueError):
        return str(v or "-")


def _build_today_summary(today_counts: dict[str, int], label: str = "금일 신규 등록") -> str:
    """금일 신규 등록 요약 — 전체 건수 + 제품별 건수를 한 줄로 간결하게."""
    total = sum(today_counts.values())
    parts = "&nbsp;&middot;&nbsp;".join(
        f'{p} <strong style="color:#1A2535">{today_counts.get(p, 0)}</strong>건' for p in _TOP_PRODUCTS
    )
    if today_counts.get("기타"):
        parts += f'&nbsp;&middot;&nbsp;기타 <strong style="color:#B91C1C">{today_counts["기타"]}</strong>건'
    return f"""
  <tr><td style="background:#FFFFFF;padding:20px 24px 16px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">
        <div style="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8796A8;margin-bottom:4px">{label}</div>
        <div style="font-size:26px;font-weight:700;color:#1A2535;font-variant-numeric:tabular-nums;line-height:1.1">{total}건</div>
      </td>
      <td style="vertical-align:middle;text-align:right;font-size:12px;color:#374151">{parts}</td>
    </tr></table>
  </td></tr>"""


def _delivery_subrow(deliveries: list[dict], bg: str) -> str:
    """신규 품목 줄 바로 아래 — 그 물품식별번호로 새로 들어온 납품요구."""
    lines = "".join(
        f'<div style="margin-top:2px">{_fmt_ymd(d.get("dlvrReqRcptDate"))} &middot; {d.get("dminsttNm") or "-"}'
        f' &middot; {d.get("corpNm") or "-"} &middot; <strong style="color:#1A2535">{_fmt_amount(d.get("prdctAmt"))}</strong></div>'
        for d in sorted(deliveries, key=lambda d: str(d.get("dlvrReqRcptDate", "")), reverse=True)
    )
    return f"""
              <tr style="background:{bg}">
                <td colspan="4" style="padding:0 12px 8px 24px;border-bottom:1px solid #EEF2F7;font-size:11px;color:#374151">
                  <span style="display:inline-block;padding:1px 7px;border-radius:10px;background:#E0E7FF;color:#1E3A8A;font-size:10px;font-weight:700">납품요구 {len(deliveries)}건</span>{lines}
                </td>
              </tr>"""


def _build_product_items_section(
    today_items: dict[str, list[dict[str, str]]],
    empty_text: str = "금일 신규 등록 품목 없음",
    deliveries_by_id: dict[str, list[dict]] | None = None,
) -> str:
    """제품별 신규 품목 등록 내역 — 이메일의 메인 콘텐츠. 등록이 없는 제품은 섹션 자체를 생략."""
    any_items = any(today_items.get(p) for p in _MAIL_SECTIONS)

    if not any_items:
        return f"""
  <tr><td style="background:#FFFFFF;padding:36px 24px;text-align:center;border-top:1px solid #EEF2F7">
    <div style="font-size:13px;color:#8796A8">{empty_text}</div>
  </td></tr>"""

    blocks = ""
    for p in _MAIL_SECTIONS:
        items = today_items.get(p) or []
        if not items:
            continue
        is_etc = p == "기타"
        rows = ""
        for i, it in enumerate(items):
            bg = "#FFFFFF" if i % 2 == 0 else "#F8FAFD"
            rows += f"""
              <tr style="background:{bg}">
                <td style="padding:8px 12px;border-bottom:1px solid #EEF2F7;font-size:12px;font-weight:600;color:#1A2535;vertical-align:top;white-space:nowrap">{it["manufacturer"] or "-"}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #EEF2F7;font-size:12px;color:#374151;vertical-align:top">{it["desc"] or "-"}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #EEF2F7;font-size:11px;color:#8796A8;vertical-align:top;white-space:nowrap">{it["item_id"] or "-"}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #EEF2F7;font-size:11px;color:#8796A8;vertical-align:top;white-space:nowrap">{it.get("reg_date") or "-"}</td>
              </tr>"""
            matched = (deliveries_by_id or {}).get(str(it.get("item_id") or "").strip())
            if matched:
                rows += _delivery_subrow(matched, bg)
        note = (
            '<div style="margin-top:6px;font-size:11px;color:#B91C1C">'
            "제품 분류 키워드에 걸리지 않은 품목입니다. 자사 제품과 관련 있는지 확인해 주세요.</div>"
            if is_etc
            else ""
        )

        blocks += f"""
  <tr><td style="background:#FFFFFF;padding:18px 24px 6px;border-top:1px solid #EEF2F7">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">{_badge(p)}</td>
      <td style="vertical-align:middle;text-align:right;font-size:11px;color:#8796A8">{len(items)}건</td>
    </tr></table>{note}
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:8px 24px 4px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E8EDF5;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#1A2F45">
          <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#C8A96E;white-space:nowrap">제조사</th>
          <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#C8A96E">품목</th>
          <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#C8A96E;white-space:nowrap">물품식별번호</th>
          <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#C8A96E;white-space:nowrap">등록일자</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  </td></tr>"""

    return blocks


def _build_cumulative_footer(cumulative_counts: dict[str, int]) -> str:
    """누적 현황 — 누적 등록 품목 수만 맨 하단에 작게 보조 정보로 제공."""
    if not cumulative_counts:
        return ""
    total = sum(cumulative_counts.get(p, 0) for p in _TOP_PRODUCTS)
    parts = "&nbsp;&middot;&nbsp;".join(
        f"{p} {cumulative_counts.get(p, 0):,}" for p in _TOP_PRODUCTS if cumulative_counts.get(p, 0)
    )
    return f"""
  <tr><td style="background:#F8FAFD;padding:12px 24px;border-top:1px solid #EEF2F7;border-radius:0 0 12px 12px">
    <div style="font-size:10px;color:#8796A8">누적 등록 품목 수 &nbsp;{total:,}건 &nbsp;({parts})</div>
  </td></tr>"""


def _build_share_strip(market_share_stats: dict[str, dict] | None, as_of_year: int) -> str:
    """제품별 점유율 현황 — 신규 등록 요약 바로 아래, 상세 품목 리스트 위에 간결하게 표시."""
    if not market_share_stats:
        return ""
    parts = []
    for p in _TOP_PRODUCTS:
        s = market_share_stats.get(p)
        if not s or s.get("our_rank") is None:
            continue
        parts.append(
            f'<span style="color:#1A2535;font-weight:700">{p}</span> '
            f"{s['our_share']:.0f}% &middot; {s['our_rank']}/{s['competitor_count']}위"
        )
    if not parts:
        return ""
    return f"""
  <tr><td style="background:#FFFFFF;padding:0 24px 16px;border-top:1px solid #EEF2F7">
    <div style="padding-top:12px;font-size:11px;color:#8796A8">
      <span style="font-weight:700;color:#8796A8">{as_of_year}년 점유율</span>
      &nbsp;&nbsp;{"&nbsp;&nbsp;&middot;&nbsp;&nbsp;".join(parts)}
    </div>
  </td></tr>"""


def build_email_html(
    *,
    end_date: date,
    period_start: date | None = None,
    new_deliveries: dict[str, list[dict]] | None = None,
    today_items: dict[str, list[dict[str, str]]] | None = None,
    cumulative_counts: dict[str, int] | None = None,
    market_share_stats: dict[str, dict] | None = None,
    dashboard_url: str | None = None,
) -> str:
    from datetime import datetime as _dt

    today_items = today_items or {}
    cumulative_counts = cumulative_counts or {}
    today_counts = {p: len(today_items.get(p, [])) for p in _MAIL_SECTIONS}

    period = _period_label(period_start, end_date)
    summary_section = _build_today_summary(today_counts, "기간 내 신규 등록" if period else "금일 신규 등록")
    share_section = _build_share_strip(market_share_stats, end_date.year)
    # 신규 납품요구는 이번 메일의 신규 품목에 매칭된 것만 해당 품목 줄 아래에 붙인다
    new_ids = {str(it.get("item_id") or "").strip() for its in today_items.values() for it in its}
    deliveries_by_id: dict[str, list[dict]] = {}
    for ds in (new_deliveries or {}).values():
        for d in ds:
            pid = str(d.get("prdctIdntNo") or "").strip()
            if pid and pid in new_ids:
                deliveries_by_id.setdefault(pid, []).append(d)
    items_section = _build_product_items_section(
        today_items, "기간 내 신규 등록 품목 없음" if period else "금일 신규 등록 품목 없음", deliveries_by_id
    )
    dlvr_total = sum(len(v) for v in deliveries_by_id.values())
    date_html = (
        f'수집 기간 <strong style="color:#fff">{period}</strong> <span style="color:#C8A96E">(미발송 기간 포함)</span>'
        if period
        else f"기준일 {end_date}"
    )
    dlvr_html = (
        f' &nbsp;|&nbsp; <span style="white-space:nowrap">납품요구 <strong style="color:#fff">{dlvr_total}</strong>건</span>'
        if dlvr_total
        else ""
    )
    footer_section = _build_cumulative_footer(cumulative_counts)

    reg_today_total = sum(today_counts.values())
    generated_at = _dt.now(SEOUL).strftime("%Y-%m-%d %H:%M")

    dashboard_link_html = ""
    if dashboard_url:
        dashboard_link_html = f"""
    <div style="margin-top:14px">
      <a href="{dashboard_url}" style="display:inline-block;background:#C8A96E;color:#1A2F45;font-size:12px;font-weight:700;text-decoration:none;border-radius:6px;padding:7px 14px">조달이 대시보드에서 전체 현황 보기 &rarr;</a>
    </div>"""

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>[조달이] 일일 신규 등록 현황 보고</title>
</head>
<body style="margin:0;padding:0;background:#F0F2F6;font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F6;padding:28px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">

  <!-- ── 헤더 ── -->
  <tr><td style="background:#1A2F45;border-radius:12px 12px 0 0;padding:26px 28px 22px">
    <div style="font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#C8A96E;margin-bottom:10px">PENTASECURITY &nbsp;·&nbsp; 나라장터 G2B 모니터링</div>
    <div style="font-size:19px;font-weight:700;color:#FFFFFF;line-height:1.3;margin-bottom:8px">일일 신규 등록 현황 보고</div>
    <div style="display:inline-block;background:rgba(255,255,255,.1);border-radius:6px;padding:5px 12px;font-size:12px;color:#A8BED4;letter-spacing:.01em">
      {date_html} &nbsp;|&nbsp; <span style="white-space:nowrap">신규 등록 <strong style="color:#fff">{reg_today_total}</strong>건</span>{dlvr_html}
    </div>
    {dashboard_link_html}
  </td></tr>

  {summary_section}

  {share_section}

  {items_section}

  {footer_section}

  <!-- ── 푸터 ── -->
  <tr><td style="padding:18px 0 6px;text-align:center">
    <div style="font-size:10px;color:#A0AEC0;line-height:1.8">
      출처 data.g2b.go.kr (나라장터 데이터포털) &nbsp;|&nbsp; 자동 발송 · 매일 09:00<br>
      생성일시 {generated_at} &nbsp;|&nbsp; Pentasecurity 조달 모니터링 시스템
    </div>
  </td></tr>

</table>
</td></tr>
</table>

</body></html>"""


def send_report_email(
    *,
    html_path: Path | None = None,
    end_date: date | None = None,
    period_start: date | None = None,
    new_deliveries: dict[str, list[dict]] | None = None,
    today_items: dict[str, list[dict[str, str]]] | None = None,
    cumulative_counts: dict[str, int] | None = None,
    market_share_stats: dict[str, dict] | None = None,
    bcc_addresses: list[str],
    smtp_user: str,
    smtp_password: str,
    dashboard_url: str | None = None,
    smtp_host: str = "smtp.gmail.com",
    smtp_port: int = 587,
) -> None:
    """보고 메일 한 통. 수신자는 모두 Bcc(수신자끼리 주소 비공개), To 는 발신 주소, 제목 앞에 [Prami]."""
    period = _period_label(period_start, end_date) if end_date is not None else None
    subject = SUBJECT_PREFIX + (
        f"[조달이] 신규 등록 현황 보고 ({period}, 미발송 기간 포함)"
        if period
        else f"[조달이] 일일 신규 등록 현황 보고 ({end_date})"
    )

    if end_date is not None:
        html_body = build_email_html(
            end_date=end_date,
            period_start=period_start,
            new_deliveries=new_deliveries,
            today_items=today_items,
            cumulative_counts=cumulative_counts,
            market_share_stats=market_share_stats,
            dashboard_url=dashboard_url,
        )
    elif html_path is not None:
        html_body = html_path.read_text(encoding="utf-8")
    else:
        raise ValueError("end_date 또는 html_path 중 하나는 필요합니다")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = smtp_user
    msg["Bcc"] = ", ".join(bcc_addresses)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    context = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.ehlo()
        server.starttls(context=context)
        server.login(smtp_user, smtp_password)
        # 봉투 수신자 = Bcc 수신자만 (To 는 발신 주소라 자기 자신에게는 보내지 않는다). send_message 는 Bcc 헤더를 떼고 보낸다.
        server.send_message(msg, from_addr=smtp_user, to_addrs=list(bcc_addresses))
