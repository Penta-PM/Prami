/**
 * 생성 파일 — 직접 고치지 마세요 (Penta 아이콘, 디자인 PR-3).
 * 다시 만들기: pnpm exec tsx scripts/gen-penta-icons.ts [라이브러리 JSON 경로]
 * 쓰는 아이콘을 늘리려면 scripts/gen-penta-icons.ts 의 PENTA_ICON_ALLOWLIST 에 이름을 더하고 다시 만든다.
 * 원본 선 두께(1px)·viewBox 그대로 — 렌더링은 src/components/icons/Icon.tsx(20·24px, aria) 로만 한다.
 */
import type { ReactElement } from 'react';

export type PentaIconDef = { viewBox: string; body: ReactElement };

export const PENTA_ICONS = {
  home: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-1044,0)">
        <path
          d="M1048.36 9.45696V19.1874H1063.65V9.45696L1056 4.81259L1048.36 9.45696Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M1066 10.886L1056 4.81259" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M1046 10.886L1056 4.81259" stroke="currentColor" strokeMiterlimit="10" />
      </g>
    ),
  },
  calculator: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-648,0)">
        <path d="M668.498 2H651.502V22H668.498V2Z" stroke="currentColor" strokeMiterlimit="10" />
        <path
          d="M665.966 4.34958H654.041V7.50549H665.966V4.34958Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M661.72 11.7261H665.846" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M663.786 9.65991V13.7859" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M654.476 16.2489L657.499 19.2725" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M657.499 16.2489L654.476 19.2725" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M661.72 17.8112H665.846" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M664.195 15.9403H663.37V16.7655H664.195V15.9403Z" fill="currentColor" />
        <path d="M664.195 18.8631H663.37V19.6882H664.195V18.8631Z" fill="currentColor" />
        <path
          d="M654.287 11.7323V11.7197C654.287 10.6678 655.08 9.81113 656.214 9.81113C656.913 9.81113 657.329 10.0441 657.669 10.378L657.153 10.9765C656.869 10.7182 656.58 10.5607 656.208 10.5607C655.584 10.5607 655.137 11.0772 655.137 11.7134V11.726C655.137 12.3623 655.578 12.8851 656.208 12.8851C656.63 12.8851 656.888 12.715 657.178 12.4505L657.694 12.9733C657.316 13.3764 656.894 13.6347 656.183 13.6347C655.093 13.6347 654.287 12.7969 654.287 11.7323Z"
          fill="currentColor"
        />
      </g>
    ),
  },
  'file-edit': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-468,-36)">
        <path
          d="M483.17 53.5215L481.231 53.7658L481.475 51.8264L486.017 47.2851L487.712 48.9872L483.17 53.5215Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M479.627 55.3423H484.475" stroke="currentColor" strokeMiterlimit="10" />
        <path
          d="M486.254 45.4433V43.0855L481.168 38H472.288V58H486.254V55.4747"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M486.142 43.2879H480.959V38.1047" stroke="currentColor" strokeMiterlimit="10" />
      </g>
    ),
  },
  users: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-324,0)">
        <path
          d="M331.637 17.0844V16.6241C331.637 15.3197 332.706 14.2558 334.005 14.2558H337.995C339.299 14.2558 340.363 15.3248 340.363 16.6241V17.0844"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <path
          d="M336 13.1765C337.234 13.1765 338.235 12.1757 338.235 10.9412C338.235 9.70667 337.234 8.7059 336 8.7059C334.765 8.7059 333.765 9.70667 333.765 10.9412C333.765 12.1757 334.765 13.1765 336 13.1765Z"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <path
          d="M326 14.2455V13.8568C326 12.7519 326.905 11.8466 328.01 11.8466H331.391"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <path
          d="M329.698 10.7008C330.743 10.7008 331.591 9.85345 331.591 8.80821C331.591 7.76296 330.743 6.91562 329.698 6.91562C328.653 6.91562 327.806 7.76296 327.806 8.80821C327.806 9.85345 328.653 10.7008 329.698 10.7008Z"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <path
          d="M346 14.2455V13.8568C346 12.7519 345.095 11.8466 343.99 11.8466H340.609"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <path
          d="M342.302 10.7008C343.347 10.7008 344.194 9.85345 344.194 8.80821C344.194 7.76296 343.347 6.91562 342.302 6.91562C341.257 6.91562 340.409 7.76296 340.409 8.80821C340.409 9.85345 341.257 10.7008 342.302 10.7008Z"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
      </g>
    ),
  },
  search: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-900,0)">
        <path
          d="M910.031 2C907.896 2 905.881 2.83008 904.37 4.34126C901.248 7.46293 901.248 12.5427 904.37 15.6573C905.881 17.1685 907.889 17.9986 910.031 17.9986C912.174 17.9986 914.182 17.1685 915.693 15.6573C918.814 12.5357 918.814 7.45584 915.693 4.34126C914.182 2.83008 912.174 2 910.031 2Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M915.764 15.7921L921.972 22" stroke="currentColor" strokeMiterlimit="10" />
      </g>
    ),
  },
  bell: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-1080,0)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1082.26 19.3459C1082.26 18.6427 1082.9 18.3705 1083.53 18.0756C1084.19 17.7732 1084.81 17.0851 1084.81 16.3819L1084.84 7.91306C1084.84 4.63896 1087.5 1.99245 1090.78 2.00002H1093.32C1096.59 2.01514 1099.24 4.67677 1099.23 7.95087L1099.21 16.4197C1099.21 17.1229 1099.84 17.811 1100.47 18.1134C1101.11 18.4234 1101.74 18.6881 1101.74 19.3837L1082.26 19.3308L1082.26 19.3459Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1094.98 19.5123C1094.98 20.8885 1093.64 22 1092 22C1090.37 22 1089.04 20.8733 1089.04 19.4972L1094.98 19.5123Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
      </g>
    ),
  },
  list: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-36,0)">
        <path
          d="M57.9087 17.4234H38.0912V22H57.9087V17.4234Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M57.9087 2H38.0912V6.57664H57.9087V2Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M57.9087 9.70804H38.0912V14.2847H57.9087V9.70804Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
      </g>
    ),
  },
  eye: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-936,0)">
        <path
          d="M938.425 10.9774C937.858 11.5447 937.858 12.4553 938.425 13.0226C939.91 14.5074 943.188 17.0779 948 17.0779C952.812 17.0779 956.09 14.5074 957.575 13.0226C958.142 12.4553 958.142 11.5447 957.575 10.9774C956.09 9.49256 952.812 6.92209 948 6.92209C943.188 6.92209 939.91 9.49256 938.425 10.9774Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M948 14.3673C949.307 14.3673 950.367 13.3074 950.367 12C950.367 10.6925 949.307 9.63263 948 9.63263C946.693 9.63263 945.633 10.6925 945.633 12C945.633 13.3074 946.693 14.3673 948 14.3673Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
      </g>
    ),
  },
  'eye-off': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-972,0)">
        <path
          d="M974.431 10.9702C973.856 11.5447 973.856 12.4623 974.431 13.0368C975.923 14.5219 979.194 17.0788 984 17.0788C988.806 17.0788 992.077 14.5219 993.569 13.0368C994.144 12.4623 994.144 11.5447 993.569 10.9702C992.077 9.48511 988.806 6.92819 984 6.92819C979.194 6.92819 975.923 9.48511 974.431 10.9702Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M984 14.3678C985.308 14.3678 986.368 13.3077 986.368 12C986.368 10.6923 985.308 9.6322 984 9.6322C982.692 9.6322 981.632 10.6923 981.632 12C981.632 13.3077 982.692 14.3678 984 14.3678Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M976.217 19.7828L991.783 4.21716" stroke="currentColor" strokeMiterlimit="10" />
      </g>
    ),
  },
  'file-log': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-756,-36)">
        <path
          d="M774.983 58V43.0855L769.898 38H761.017V58H774.983Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M774.871 43.2877H769.688V38.1046" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M765.217 51.1356H765.684V53.933H765.217V51.1356Z" fill="currentColor" />
        <path
          d="M766.179 52.9285V52.9216C766.179 52.3426 766.64 51.8612 767.261 51.8612C767.881 51.8612 768.335 52.3356 768.335 52.9146V52.9216C768.335 53.4936 767.874 53.9749 767.254 53.9749C766.64 53.9749 766.179 53.5076 766.179 52.9285ZM767.874 52.9285V52.9216C767.874 52.5658 767.616 52.2728 767.254 52.2728C766.884 52.2728 766.647 52.5658 766.647 52.9146V52.9216C766.647 53.2773 766.905 53.5703 767.261 53.5703C767.637 53.5703 767.874 53.2773 767.874 52.9285Z"
          fill="currentColor"
        />
        <path
          d="M768.809 54.3098L768.984 53.961C769.2 54.0935 769.43 54.1703 769.702 54.1703C770.114 54.1703 770.344 53.9611 770.344 53.5565V53.4029C770.176 53.6191 769.967 53.7726 769.632 53.7726C769.151 53.7726 768.712 53.4239 768.712 52.824V52.817C768.712 52.2171 769.158 51.8682 769.632 51.8682C769.974 51.8682 770.183 52.0286 770.344 52.21V51.9101H770.811V53.5216C770.811 53.8634 770.721 54.1144 770.553 54.2818C770.372 54.4632 770.086 54.554 769.723 54.554C769.381 54.554 769.067 54.4632 768.809 54.3098ZM770.344 52.817V52.81C770.344 52.4821 770.072 52.2589 769.751 52.2589C769.43 52.2589 769.179 52.4752 769.179 52.81V52.817C769.179 53.1449 769.437 53.3751 769.751 53.3751C770.072 53.3751 770.344 53.1449 770.344 52.817Z"
          fill="currentColor"
        />
      </g>
    ),
  },
  'file-text': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-1080,-36)">
        <path
          d="M1100.37 58H1083.63V38H1098.02C1098.93 38.9151 1099.45 39.4314 1100.37 40.3465V58Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M1094.51 41.7386H1094.19C1093.83 41.7386 1093.54 42.028 1093.54 42.3878V46.2361C1093.54 47.8395 1094.84 49.1458 1096.45 49.1458C1096.81 49.1458 1097.1 48.8563 1097.1 48.4965V44.3276C1097.1 42.8962 1095.95 41.7386 1094.51 41.7386Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M1089.48 41.7386H1089.8C1090.16 41.7386 1090.45 42.028 1090.45 42.3878V46.2361C1090.45 47.8395 1089.15 49.1458 1087.54 49.1458C1087.18 49.1458 1086.89 48.8563 1086.89 48.4965V44.3276C1086.89 42.8962 1088.05 41.7386 1089.48 41.7386Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M1086.89 52.2198H1097.1" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M1086.89 54.6757H1097.1" stroke="currentColor" strokeMiterlimit="10" />
      </g>
    ),
  },
  'chart-line': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-612,0)">
        <path d="M631.013 6.13968H633.646V8.77243" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M614 17.8604H634" stroke="currentColor" strokeMiterlimit="10" />
        <path
          d="M633.519 6.25339L627.732 12.1203L624.545 8.51198L621.09 13.6238L617.709 6.90154L614 10.7104"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
      </g>
    ),
  },
  message: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-1116,0)">
        <path
          d="M1128 16.8373H1138V3.28696H1118V16.8373H1123.48V20.7131L1128 16.8373Z"
          stroke="currentColor"
          strokeMiterlimit="10"
          strokeLinecap="round"
        />
        <path
          d="M1122.57 10.9413C1123.12 10.9413 1123.57 10.4958 1123.57 9.94616C1123.57 9.39656 1123.12 8.95102 1122.57 8.95102C1122.02 8.95102 1121.58 9.39656 1121.58 9.94616C1121.58 10.4958 1122.02 10.9413 1122.57 10.9413Z"
          fill="currentColor"
        />
        <path
          d="M1128 10.9413C1128.55 10.9413 1129 10.4958 1129 9.94616C1129 9.39656 1128.55 8.95102 1128 8.95102C1127.45 8.95102 1127.01 9.39656 1127.01 9.94616C1127.01 10.4958 1127.45 10.9413 1128 10.9413Z"
          fill="currentColor"
        />
        <path
          d="M1133.44 10.9413C1133.99 10.9413 1134.43 10.4958 1134.43 9.94616C1134.43 9.39656 1133.99 8.95102 1133.44 8.95102C1132.89 8.95102 1132.44 9.39656 1132.44 9.94616C1132.44 10.4958 1132.89 10.9413 1133.44 10.9413Z"
          fill="currentColor"
        />
      </g>
    ),
  },
  grid: {
    viewBox: '0 0 24 24',
    body: (
      <>
        <path d="M10.1744 2H2V10.1744H10.1744V2Z" stroke="currentColor" strokeMiterlimit="10" />
        <path
          d="M10.1744 13.8256H2V22H10.1744V13.8256Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M22.0001 2H13.8257V10.1744H22.0001V2Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M22.0001 13.8256H13.8257V22H22.0001V13.8256Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
      </>
    ),
  },
  'won-note': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-216,0)">
        <path d="M238 7.306H218V16.694H238V7.306Z" stroke="currentColor" strokeMiterlimit="10" />
        <path
          d="M238 9.58519C236.74 9.58519 235.721 8.56618 235.721 7.306"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M218 9.58519C219.26 9.58519 220.279 8.56618 220.279 7.306"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M238 14.4149C236.74 14.4149 235.721 15.4338 235.721 16.694"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M218 14.4149C219.26 14.4149 220.279 15.4338 220.279 16.694"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M231.223 11.4482H230.403L230.921 9.98301H230.33L229.83 11.4482H228.721L228.25 10.0132L228.238 9.97101H227.786L227.304 11.4482H226.194L225.694 9.98301H225.085L225.603 11.4482H224.789V12.0331H225.814L226.508 13.9927L226.52 14.0349H226.972L227.653 12.0331H228.359L229.034 14.0349H229.492L230.204 12.0331H231.229V11.4482H231.223ZM227.111 12.0331L226.761 13.1063L226.393 12.0331H227.111ZM228.154 11.4482H227.846L228.003 10.996L228.154 11.4482ZM229.631 12.0331L229.263 13.1063L228.914 12.0331H229.631Z"
          fill="currentColor"
        />
      </g>
    ),
  },
  'blocks-2': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-900,-36)">
        <path
          d="M902.552 40.0631V44.1836L906.124 46.2466L909.694 44.1836V40.0631L906.124 38L902.552 40.0631Z"
          stroke="currentColor"
          strokeMiterlimit="10"
          strokeLinecap="square"
        />
        <path
          d="M902.552 40.0631L906.124 42.1204L909.694 40.0631"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M906.124 42.1204V46.2466" stroke="currentColor" strokeMiterlimit="10" />
        <path
          d="M914.312 51.8164V55.9427L917.883 58L921.448 55.9427V51.8164L917.883 49.7592L914.312 51.8164Z"
          stroke="currentColor"
          strokeMiterlimit="10"
          strokeLinecap="square"
        />
        <path
          d="M914.312 51.8166L917.883 53.8797L921.448 51.8166"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M917.883 53.8797V58.0001" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M912.739 42.1204H917.883V47.2635" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M911.267 54.3881H906.124V49.2449" stroke="currentColor" strokeMiterlimit="10" />
      </g>
    ),
  },
  warning: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-288,0)">
        <path
          d="M304.999 7.00384C307.762 9.76721 307.762 14.2386 304.999 17.002C302.236 19.7653 297.764 19.7653 295.001 17.002C292.238 14.2386 292.238 9.76721 295.001 7.00384C297.764 4.24047 302.236 4.24047 304.999 7.00384Z"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path d="M300.004 7.25365V14.2145" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M300.004 15.4795V16.7443" stroke="currentColor" strokeMiterlimit="10" />
        <path
          d="M307.069 4.93348C310.977 8.84087 310.977 15.1652 307.069 19.0726"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
        <path
          d="M292.931 19.0645C289.023 15.1571 289.023 8.8328 292.931 4.92542"
          stroke="currentColor"
          strokeMiterlimit="10"
        />
      </g>
    ),
  },
  close: {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-216,0)">
        <path d="M218 2L238 22" stroke="currentColor" strokeMiterlimit="10" />
        <path d="M238 2L218 22" stroke="currentColor" strokeMiterlimit="10" />
      </g>
    ),
  },
  'chevron-right': {
    viewBox: '0 0 24 24',
    body: (
      <g transform="translate(-288,0)">
        <path
          d="M294.661 22L305.339 12L294.661 2"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    ),
  },
} satisfies Record<string, PentaIconDef>;

export type PentaIconName = keyof typeof PENTA_ICONS;
