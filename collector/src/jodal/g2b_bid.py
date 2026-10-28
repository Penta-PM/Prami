"""나라장터 입찰공고 수집 — www.g2b.go.kr 입찰공고목록 화면이 쓰는 조회 요청을 그대로 호출한다.

공공데이터포털 입찰공고정보서비스는 활용 승인이 나지 않아(SERVICE_KEY_IS_NOT_REGISTERED_ERROR) 쓸 수 없으므로,
로그인 없이 열리는 "입찰 > 입찰공고 > 입찰공고목록" 화면의 조회 요청을 재현한다. 공식 API가 아니어서 사이트 개편 때
헤더나 본문 키가 바뀌면 403이 날 수 있다 — 그때는 화면에서 조회 요청을 다시 캡처해 _HEADERS/_BODY를 고친다.

제품 키워드(공고명 부분일치)로 공고를 모은다. DB 반영은 db.sync_bids (procurement.bid_notices).
"""

from __future__ import annotations

import html
import http.cookiejar
import json
import re
import time
import urllib.request
from datetime import date

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
_HOME = "https://www.g2b.go.kr/"
_LIST_URL = "https://www.g2b.go.kr/pn/pnp/pnpe/BidPbac/selectBidPbacScrollTypeList.do"
_DETAIL_URL = "https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo={no}&bidPbancOrd={ord}"
_HEADERS = {
    "menu-info": '{"menuNo":"01175","menuCangVal":"PNPE001_01","bsneClsfCd":"%EC%97%85130026","scrnNo":"00941"}',
    "submissionid": "mf_wfm_container_tacBidPbancLst_contents_tab2_body_sbmPbancBidPbancLst",
    "target-id": "btnS0004",
    "usr-id": "null",
}
_BODY = {
    "untyBidPbancNo": "",
    "bidPbancNo": "",
    "bidPbancOrd": "",
    "prcmBsneUntyNoOrd": "",
    "prcmBsneSeCd": "0000 조070001 조070002 조070003 조070004 조070005 민079999",
    "bidPbancNm": "",
    "pbancPstgDt": "",
    "ldocNoVal": "",
    "bidPrspPrce": "",
    "ctrtDmndRcptNo": "",
    "dmstcOvrsSeCd": "",
    "pbancKndCd": "공440002",
    "ctrtTyCd": "",
    "bidCtrtMthdCd": "",
    "scsbdMthdCd": "",
    "fromBidDt": "",
    "toBidDt": "",
    "minBidPrspPrce": "",
    "maxBidPrspPrce": "",
    "bsneAllYn": "Y",
    "frcpYn": "Y",
    "rsrvYn": "Y",
    "laseYn": "Y",
    "untyGrpGb": "",
    "dmstNm": "",
    "pbancPicNm": "",
    "odnLmtLgdngCd": "",
    "odnLmtLgdngNm": "",
    "intpCd": "",
    "intpNm": "",
    "dtlsPrnmNo": "",
    "dtlsPrnmNm": "",
    "slprRcptDdlnYn": "",
    "lcrtTyCd": "",
    "isMas": "",
    "isElpdt": "",
    "oderInstUntyGrpNo": "",
    "instSearchRangeYn": "",
    "esdacYn": "",
    "infoSysCd": "정010029",
    "contxtSeCd": "콘010006",
    "bidDateType": "R",
    "brcoOrgnCd": "",
    "deptOrgnCd": "",
    "isShop": "",
    "srchTy": "0",
    "cangParmVal": "",
    "currentPage": "",
    "recordCountPerPage": "500",
    "startIndex": 1,
    "endIndex": 500,
}
_PAGE = 500

# 서버 검색어(공고명 부분일치) — 넓게 받아 온 뒤 아래 키워드로 제품을 판정한다.
# 아래 키워드 중 이 검색어로 이미 찾아지지 않는 것은 그 키워드 자체로도 검색한다.
_BASE_SEARCH = [
    "방화벽",
    "WAF",
    "WAAP",
    "암호",
    "키관리",
    "HSM",
    "KMS",
    "SSO",
    "통합인증",
    "통합계정",
    "PKI",
    "공인인증",
    "전자서명",
    "OTP",
    "FIDO",
    "생체인증",
    "간편인증",
    "제로트러스트",
    "싱글사인온",
    "EAM",
    "IAM",
]
# 제품별 키워드 (공고명에 들어 있으면 그 제품 관련 공고) + "제외" 단어 (들어 있으면 버린다).
# 운영 중에는 DB의 bid_keywords 표(대시보드 "키워드 설정")가 이것을 대신한다 — 이 목록은 처음 채울 때와 시트 모드용.
# 판정 규칙(keyword_pattern): 띄어 쓴 자리는 붙여 써도 맞고, 영문 약어는 앞뒤가 영문자가 아닐 때만 맞는다.
DEFAULT_KEYWORDS: dict[str, list[str]] = {
    "WAPPLES": ["웹 방화벽", "웹 애플리케이션 방화벽", "웹 어플리케이션 방화벽", "WAF", "WAAP"],
    "D.AMO": [
        "DB 암호",
        "데이터베이스 암호",
        "데이터 암호",
        "개인정보 암호",
        "고유식별정보 암호",
        "칼럼 암호",
        "컬럼 암호",
        "파일 암호",
        "문서 암호",
        "암호화 솔루션",
        "암호화 시스템",
        "암호화 제품",
        "암호화 모듈",
        "암호화 소프트웨어",
        "암호화 SW",
        "암호화 S/W",
        "암호화 장비 구매",
        "암호 모듈",
        "키 관리",
        "HSM",
    ],
    "iSIGN": [
        "통합 인증",
        "통합 계정",
        "공인 인증",
        "전자 서명",
        "생체 인증",
        "간편 인증",
        "제로 트러스트",
        "싱글 사인 온",
        "SSO",
        "PKI",
        "OTP",
        "FIDO",
        "EAM",
        "IAM",
    ],
    "제외": [
        "ISO",
        "인증 심사",
        "사후 심사",
        "국가 공인 인증",
        "KS 인증",
        "국제 인증",
        "인증 획득",
        "인증 취득",
        "인증 컨설팅",
        "선도학교",
        "터치스크린",
        "전자서명기",
        "구명뗏목",
        "공모전",
        "어워드",
    ],
}
PRODUCTS = ("WAPPLES", "D.AMO", "iSIGN")


def keyword_pattern(keyword: str) -> re.Pattern:
    """키워드 → 판정식. 띄어 쓴 자리는 붙여 써도 맞고("웹 방화벽" = "웹방화벽"), 나머지는 글자 그대로.
    영문 약어는 앞뒤가 영문자가 아닐 때만 맞는다 (SSO가 COMPRESSOR 속에서 걸리지 않게)."""
    parts = [re.escape(w) for w in keyword.upper().split()]
    body = r"\s*".join(parts)
    if re.fullmatch(r"[A-Z0-9/.+&\s-]+", keyword.upper()):
        return re.compile(rf"(?<![A-Z]){body}(?![A-Z])")
    return re.compile(body)


class KeywordRules:
    """제품별 키워드 + 제외 단어로 공고명을 판정한다."""

    def __init__(self, keywords: dict[str, list[str]]):
        self.keywords = {p: [k for k in keywords.get(p, []) if k.strip()] for p in (*PRODUCTS, "제외")}
        self._pats = {p: [(k, keyword_pattern(k)) for k in ks] for p, ks in self.keywords.items()}

    def classify(self, title: str) -> tuple[list[str], list[str]]:
        """반환: (관련 제품, 걸린 키워드). 제외 단어가 있으면 ([], [])."""
        t = title.upper()
        if any(rx.search(t) for _, rx in self._pats["제외"]):
            return [], []
        products, matched = [], []
        for p in PRODUCTS:
            hits = [k for k, rx in self._pats[p] if rx.search(t)]
            if hits:
                products.append(p)
                matched += hits
        return products, matched

    def search_terms(self) -> list[str]:
        """나라장터에 보낼 검색어 — 기본 검색어 + 그것으로 찾아지지 않는 키워드."""
        terms = list(_BASE_SEARCH)
        for p in PRODUCTS:
            for k in self.keywords[p]:
                kk = re.sub(r"\s+", "", k).upper()
                if not any(b.upper() in kk for b in terms):
                    terms.append(re.sub(r"\s+", "", k))
        return terms


DEFAULT_RULES = KeywordRules(DEFAULT_KEYWORDS)
# 공사 공고는 제외 (예: "전자서명인증관리센터 칸막이 공사")
_EXCLUDE_BSNE = {"공사"}


def classify_bid(title: str, rules: KeywordRules = DEFAULT_RULES) -> list[str]:
    return rules.classify(title)[0]


def _opener():
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    op.open(urllib.request.Request(_HOME, headers={"User-Agent": _UA}), timeout=30).read()
    return op


def _query(op, term: str, start: date, end: date) -> list[dict]:
    out: list[dict] = []
    s = 1
    while True:
        body = dict(
            _BODY,
            bidPbancNm=term,
            fromBidDt=f"{start:%Y%m%d}",
            toBidDt=f"{end:%Y%m%d}",
            recordCountPerPage=str(_PAGE),
            startIndex=s,
            endIndex=s + _PAGE - 1,
        )
        req = urllib.request.Request(
            _LIST_URL,
            data=json.dumps({"dlBidPbancLstM": body}).encode(),
            method="POST",
            headers={
                "Content-Type": "application/json;charset=UTF-8",
                "Accept": "application/json",
                "User-Agent": _UA,
                "Referer": _HOME,
                **_HEADERS,
            },
        )
        with op.open(req, timeout=60) as r:
            rows = json.loads(r.read().decode("utf-8")).get("result") or []
        out += rows
        # 응답의 nextRowYn은 믿을 수 없어, 받은 건수가 한 페이지보다 적으면 끝으로 본다
        if len(rows) < _PAGE:
            return out
        s += _PAGE
        time.sleep(1)


def _split_dt(v: str) -> tuple[str, str]:
    """ "2026/10/15 17:14<br/>(2026/10/22 10:00)" → ("2026-10-15 17:14", "2026-10-22 10:00")."""
    v = html.unescape(v or "")
    dts = re.findall(r"\d{4}/\d{2}/\d{2}(?: \d{2}:\d{2})?", v)
    dts = [d.replace("/", "-") for d in dts]
    return (dts[0] if dts else "", dts[1] if len(dts) > 1 else "")


def fetch_bid_notices(start: date, end: date, rules: KeywordRules = DEFAULT_RULES) -> list[dict]:
    """기간 내 공고 중 제품 키워드에 걸린 것 (공고번호별 최신 차수 하나)."""
    op = _opener()
    by_no: dict[str, dict] = {}
    for term in rules.search_terms():
        for r in _query(op, term, start, end):
            title = html.unescape(r.get("bidPbancNm") or "").strip()
            products, matched = rules.classify(title)
            if not products or (r.get("prcmBsneSeCdNm") or "") in _EXCLUDE_BSNE:
                continue
            no, ordv = r.get("bidPbancUntyNo") or "", r.get("bidPbancUntyOrd") or "000"
            prev = by_no.get(no)
            if prev and prev["_ord"] >= ordv:
                continue
            posted, deadline = _split_dt(r.get("pbancPstgDt"))
            by_no[no] = {
                "_ord": ordv,
                "공고번호": f"{no}-{ordv}",
                "관련 제품": ", ".join(products),
                "키워드": ", ".join(dict.fromkeys(matched)),
                "공고명": title,
                "업무구분": r.get("prcmBsneSeCdNm") or "",
                "공고기관": html.unescape(r.get("oderInstUntyGrpNm") or ""),
                "수요기관": html.unescape(r.get("dmstNm") or ""),
                "공고일시": posted,
                "입찰마감일시": deadline,
                "배정예산": r.get("alotBgtAmt") if r.get("alotBgtAmt") is not None else "",
                "추정가격": r.get("prspPrce") if r.get("prspPrce") is not None else "",
                "공고상태": r.get("pbancSttsNm") or "",
                "상세URL": r.get("linkInstPbancLnkUrl") or _DETAIL_URL.format(no=no, ord=ordv),
            }
        time.sleep(1)
    rows = sorted(by_no.values(), key=lambda x: x["공고일시"], reverse=True)
    for x in rows:
        x.pop("_ord")
    return rows
