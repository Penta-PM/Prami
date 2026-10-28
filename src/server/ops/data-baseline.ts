/**
 * `pnpm data:verify` 기준값 (PRAMI-003 §4.9.2, r3 원본 기준). 원본 엑셀 7개의 SHA-256 과 클린 설치 후 기대 수치.
 * DB 에 적용된 배치의 SHA-256 이 이 값과 다르면 수치를 비교하지 않고 실측값만 출력한다(exit 2 — Plan 기준값 재계산 필요).
 * 원본 파일은 저장소에 없다(`_inputs/` 는 저장소 밖). 여기에는 해시와 개수만 둔다.
 */
export type DataBaseline = {
  sources: {
    sales: string;
    costs: string;
    /** 품목조회 5파일 — 배치 source_files 의 sha256 집합과 비교 (순서 무관) */
    items: readonly string[];
  };
  expected: {
    migrations: number;
    items: number;
    itemStatus: Readonly<Record<string, number>>;
    itemMajor: Readonly<Record<string, number>>;
    itemKind: Readonly<Record<string, number>>;
    salesRows: number;
    salesSeries: number;
    salesLatest: number;
    operating: number;
    unused: number;
    costRows: number;
  };
};

export const DATA_BASELINE: DataBaseline = {
  sources: {
    // _inputs/PRAMI-001/병합_가격_raw.xlsx (RAW 시트 5,885행)
    sales: '4136ba11b8266c4ac35c2f5cdb9124139efd03d0644ff7941dbe490c7a6ea0df',
    // _inputs/PRAMI-001/원자재코드 정보_260825.xlsx (487행)
    costs: 'dd19e981474a640d42b518f5a3beb76e5d14f6b5856a923aaf479314c536940c',
    // _inputs/PRAMI-003/ WAPPLES·D'AMO·iSIGN·iSGIN PKI·cloudbric 품목.xlsx (합계 2,511행)
    items: [
      '28c9f67a45d6bc9e21d8765b0bf73619e4630fdbd7173e97cb2d50d45e3b58c1',
      'e8247e0c29c800d85a5196c67b29647b74f3ef9e6f7ed93f94b6af1ca29f553e',
      '36ce89b6e2c3d4e7578a20ee4422dd93bcdf358aa471dac4cc3faa11f222df80',
      'b347ba85614eb3ed0226fe417c03ad5e3c63a70c706a844acc4bfd51843c159b',
      'af9d0fd554606312ad6c552beb71654bf23305650b9a00596117f75dfdf67317',
    ],
  },
  expected: {
    migrations: 15,
    items: 2511,
    itemStatus: { 사용: 856, 폐기: 1609, 임시: 46 },
    itemMajor: { WAPPLES: 385, 'D.AMO': 1335, iSIGN: 420, 'iSIGN PKI': 215, Cloudbric: 156 },
    itemKind: { 본품: 2203, 파츠: 121, 서비스: 108, 결합형: 63, 기타: 16 },
    salesRows: 5885,
    salesSeries: 3810,
    salesLatest: 3810,
    operating: 2428,
    unused: 3457,
    costRows: 487,
  },
};
