# semips — LoL 라인 카운터 / 바텀 듀오 조회

리그 오브 레전드 전적 사이트 **op.gg**의 데이터를 요청이 들어올 때마다 실시간으로 가져와 보여주는 웹 앱입니다. 자체 DB나 데이터 수집 파이프라인이 없습니다 — 매 조회가 곧 op.gg 조회입니다.

- **라인 카운터**: 챔피언 + 라인을 고르면 그 조합을 상대하기 좋은/나쁜 챔피언과 승률을 보여줍니다.
- **바텀 듀오 시너지**: 원거리 딜러 + 서포터 조합의 실제 시너지 승률을 보여줍니다.

> ⚠️ op.gg는 자동 수집을 약관으로 제한하는 경우가 많습니다. 이 앱은 **개인용 학습 프로젝트**를 전제로 최소한의 페이지만, 짧은 캐시를 두고 가져옵니다. 실사용/공개 배포 전에 op.gg 이용약관을 직접 확인하세요.

## 기술 스택

- Next.js (App Router, TypeScript) — 프론트엔드 + API 라우트
- Data Dragon — 챔피언 이름/아이콘 등 정적 데이터 (공식, 무료, 인증 불필요)
- op.gg 실시간 스크래핑 — 라인 카운터 / 바텀 듀오 승률 (`src/lib/opgg.ts`)

DB도, API 키도 필요 없습니다. `npm install && npm run dev`만으로 뜹니다.

## 동작 원리

1. 챔피언 목록/아이콘은 Data Dragon에서 가져옵니다 (`src/lib/ddragon.ts`, 1시간 캐시, 오프라인이면 `data/fallback-champions.json`으로 대체).
2. 카운터/듀오 조회는 `src/lib/opgg.ts`가 해당 챔피언의 op.gg 페이지를 그때그때 fetch해서, 페이지에 내장된 Next.js `__NEXT_DATA__` JSON을 파싱해 통계를 뽑아냅니다.
3. 같은 조합을 반복 조회할 때 op.gg에 부담을 덜 주기 위해 10분짜리 인메모리 캐시를 씁니다 (서버 재시작/재배포 시 초기화됨 — 영구 저장소가 아닙니다).

## ⚠️ op.gg 연동 관련 중요 주의사항

`src/lib/opgg.ts`의 URL 패턴과 JSON 필드명은 **이 세션에서 실제 op.gg 접속이 막혀 있어 직접 검증하지 못했습니다** (샌드박스가 op.gg로 나가는 아웃바운드 요청을 차단함). op.gg의 일반적인 Next.js 구조를 근거로 한 최선의 추정치입니다:

- 카운터 조회: `https://www.op.gg/lol/champions/{slug}/counters?position={position}`
- 듀오 조회: `https://www.op.gg/lol/champions/{adcSlug}/duos?position=adc`
- 페이지 HTML에서 `__NEXT_DATA__` 스크립트 태그를 찾아 JSON으로 파싱한 뒤, `championId`류 필드 + `winRate`/`wins`류 필드를 동시에 가진 배열을 트리에서 탐색합니다 (정확한 경로를 하드코딩하지 않고 모양 기반으로 탐색 — 완전히 틀린 구조가 아니라면 약간의 필드명 차이 정도는 버틸 수 있게 설계했습니다).

**로컬에서 실행해보고 안 되면** 에러 메시지를 그대로 알려주세요 — API가 던지는 에러에는 HTTP 상태 코드 또는 "어떤 부분을 못 찾았는지"가 담겨 있어서 바로 원인을 좁힐 수 있습니다. 특히 확인이 필요한 부분:

1. **URL이 맞는지** (404가 나면 실제 URL 패턴이 다른 것)
2. **챔피언 슬러그 매핑이 맞는지** — `toOpggSlug()`는 기본적으로 Data Dragon 슬러그를 소문자로 바꿔 쓰는데, 우콩(`MonkeyKing` → `wukong`)처럼 예외인 챔피언이 더 있을 수 있습니다
3. **JSON 필드명이 맞는지** — op.gg가 실제로 쓰는 키 이름이 여기서 가정한 것(`championId`, `winRate`, `games` 류)과 다르면 데이터를 못 찾습니다

## 시작하기

```bash
npm install
npm run dev
```

바로 `http://localhost:3000`에서 확인 가능합니다. 환경 변수도 필요 없습니다.

## 스크립트

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` / `npm run start` | 프로덕션 빌드 / 실행 |
| `npm run lint` | ESLint |

## 폴더 구조

```
src/
  app/
    page.tsx                # 메인 UI (라인 카운터 / 바텀 듀오 모드)
    api/champions/          # GET 챔피언 목록 (Data Dragon, 폴백 포함)
    api/counters/           # GET 챔피언+라인 → 카운터 리스트 (op.gg 실시간)
    api/duo/                # GET ADC+서포터 → 듀오 시너지 (op.gg 실시간)
  components/                # ChampionPicker, ChampionIcon, WinRateBar
  lib/
    ddragon.ts               # Data Dragon 클라이언트 (+ 오프라인 폴백)
    opgg.ts                  # op.gg 실시간 스크래퍼 (핵심 로직)
    cache.ts                 # 짧은 TTL 인메모리 캐시
data/fallback-champions.json # Data Dragon 접근 불가 시 쓰는 오프라인 챔피언 스냅샷
```

## 알려진 제한사항

- **op.gg 페이지 구조 미검증** (위 "중요 주의사항" 참고) — 가장 먼저 확인이 필요한 부분입니다.
- 인메모리 캐시는 서버리스/재배포 환경에서 인스턴스마다 따로 놀고 쉽게 초기화됩니다. 완전히 신뢰할 캐시가 필요하면 Redis 등 외부 캐시로 바꾸는 걸 권장합니다.
- op.gg가 요청을 차단(403/429)하면 그대로 에러로 보여줍니다 — 우회를 시도하지 않습니다. 반복적으로 막힌다면 조회 빈도를 줄이거나 op.gg에 직접 이용 허가를 문의하는 걸 권장합니다.
- 5개 챔피언 전체 조합 평가처럼 op.gg에 없는 통계는 더 이상 제공하지 않습니다 (실제 존재하는 데이터만 보여주는 쪽으로 방향을 바꿨습니다).
