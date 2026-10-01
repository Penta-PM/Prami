-- PRAMI-003 PR-1 QA M-1: 0005 의 source DEFAULT 'master' + CHECK(items_master_required_ck) 때문에 직전 앱(da1b186·1605ad7)의
-- 쓰기 경로가 23514 로 실패했다 — source 를 모르는 구 코드가 종류·상태·대분류 없이 품번을 넣거나(판매단가 stub, 파츠 매핑 stub)
-- 그 값을 비우는 upsert(구 품목 배치 적용)를 하면 기본값 master 가 CHECK 를 어긴다.
-- 0005 의 백필 규칙(종류·상태·대분류 중 하나라도 비면 stub)을 쓰기 시점에도 적용해, 구 코드의 쓰기가 stub 으로 들어가게 한다.
-- 신 코드는 master 를 검증된 스테이징 값(세 필드 모두 있음)으로만 쓰므로 영향이 없고, CHECK 는 최후 방어선으로 남긴다.
-- contract: 직전 앱 버전으로의 롤백 가능성이 없어진 뒤(PRAMI-003 PR-5 운영 배포 이후) 트리거를 제거하는 마이그레이션을 따로 둔다.
CREATE OR REPLACE FUNCTION "items_demote_incomplete_master"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."source" = 'master'
     AND (NEW."item_kind" IS NULL OR NEW."item_status" IS NULL OR NEW."category_major" IS NULL) THEN
    NEW."source" := 'stub';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "items_demote_incomplete_master"
BEFORE INSERT OR UPDATE ON "items"
FOR EACH ROW EXECUTE FUNCTION "items_demote_incomplete_master"();
