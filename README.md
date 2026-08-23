# semips — LoL 라인 카운터 / 바텀 듀오 / 픽 추천 (다중 소스)

리그 오브 레전드 전적 사이트 **6곳**(op.gg, u.gg, lolalytics, Mobalytics, DeepLoL, lol.ps)의 데이터를 요청이 들어올 때마다 실시간으로 가져와 합쳐서 보여주는 웹 앱입니다. 자체 DB나 데이터 수집 파이프라인이 없습니다 — 매 조회가 곧 각 사이트에 대한 실시간 조회입니다.

- **라인 카운터**: 챔피언 + 라인을 고르면 그 조합을 상대하기 좋은/나쁜 챔피언과 승률을 여러 사이트에서 가져와 보여줍니다.
- **바텀 듀오 시너지**: 원거리 딜러 + 서포터 조합의 실제 시너지 승률을 여러 사이트에서 가져와 보여줍니다.
- **픽 추천**: 실제 픽창처럼 **우리팀 5칸 + 상대팀 5칸, 총 10칸**짜리 입력판에서 내가 픽할 포지션을 고르고 아는 만큼만 채우면 좋은 픽을 추천합니다. 내부적으로 라인 카운터/바텀 듀오와 **같은 데이터**를 재사용합니다 — 다만 실제로 추천에 반영되는 건 10칸 중 **상대의 내 포지션 칸**(라인 카운터 데이터)과, 서포터를 픽할 때는 **우리팀 원거리 딜러 칸**(듀오 시너지 데이터) 뿐입니다. 상대 라이너가 채워져 있으면 그 챔피언을 상대로 승률 높은 챔피언 목록(=카운터)을, 서포터를 픽하는 중이고 우리팀 원거리 딜러가 채워져 있으면 그 원거리 딜러와 시너지 좋은 서포터 목록을 보여주고, 둘 다 있으면 두 지표를 평균 내 "둘 다 좋은 픽"도 따로 보여줍니다. 나머지 칸(예: 상대 정글, 우리팀 미드 등)은 지금 당장은 추천 계산에 쓰이지 않는, 더 많은 사이트를 연동하면 활용할 수 있도록 미리 마련해둔 자리라는 걸 화면에도 명시해뒀습니다. 시너지 추천이 서포터를 픽할 때만 제공되는 이유는, 확인된 사이트 데이터가 "원거리 딜러 → 시너지 좋은 서포터" 방향의 목록만 있고 반대 방향(서포터를 알고 있을 때 원거리 딜러 추천)이나 탑/정글/미드의 팀 시너지 데이터는 확인된 소스가 없기 때문입니다.
- 매칭당 표본(게임 수)이 가장 많은 소스를 대표값으로 쓰고, **표본이 많은 순으로 최대 3개 소스**를 함께 보여줍니다.

> ⚠️ 이런 전적 사이트들은 자동 수집을 약관으로 제한하는 경우가 많습니다. 이 앱은 **개인용 학습 프로젝트**를 전제로 최소한의 페이지만, 짧은 캐시를 두고 가져옵니다. 실사용/공개 배포 전에 각 사이트의 이용약관을 직접 확인하세요.

## 기술 스택

- Next.js (App Router, TypeScript) — 프론트엔드 + API 라우트
- Data Dragon — 챔피언 이름/아이콘 등 정적 데이터 (공식, 무료, 인증 불필요)
- 6개 사이트 실시간 스크래핑 — `src/lib/sources/`

DB도, API 키도 필요 없습니다. `npm install && npm run dev`만으로 뜹니다.

## 동작 원리

1. 챔피언 목록/아이콘은 Data Dragon에서 가져옵니다 (`src/lib/ddragon.ts`, 1시간 캐시, 오프라인이면 `data/fallback-champions.json`으로 대체).
2. 카운터/듀오를 조회하면 등록된 6개 소스에 **동시에** 요청을 보냅니다 (`src/lib/sources/aggregate.ts`, `Promise.allSettled`로 일부가 실패해도 나머지로 계속 진행).
3. 각 소스는 해당 챔피언의 페이지를 fetch해서, 페이지에 내장된 상태를 파싱해 통계를 뽑아냅니다 (`src/lib/scrape.ts`). 두 가지 임베딩 방식을 지원합니다: 구형 `__NEXT_DATA__`/`__NUXT__` 단일 JSON 블록, 그리고 최신 Next.js App Router가 쓰는 `self.__next_f.push(...)` RSC Flight 스트림(여러 개의 `id:value` 줄로 쪼개져 있고, 값 부분만 따로 JSON 파싱). op.gg가 실제로 후자 방식이라는 걸 실제 페이지 소스로 확인했습니다.
4. 같은 상대 챔피언에 대해 여러 소스가 값을 준 경우, **게임 수가 가장 많은 소스**를 대표값으로 쓰고 상위 3개 소스를 같이 보여줍니다.
5. 같은 조합을 반복 조회할 때 각 사이트에 부담을 덜 주기 위해 소스별로 10분짜리 인메모리 캐시를 씁니다 (서버 재시작/재배포 시 초기화됨 — 영구 저장소가 아닙니다).

## ⚠️ 각 소스 연동 신뢰도 — 반드시 읽어주세요

이 세션은 **6개 사이트 전부에 대한 아웃바운드 네트워크가 막혀 있어** 대부분 직접 검증하지 못했습니다. `src/lib/sources/registry.ts`에 있는 URL 패턴/필드명은 각 사이트 구조에 대한 사전 지식을 근거로 한 최선의 추정치입니다. 소스별 신뢰도:

| 소스 | 신뢰도 | 비고 |
| --- | --- | --- |
| op.gg | 높음 | **URL과 실제 데이터 필드 구조까지 확정**: 카운터는 `/lol/champions/{slug}/counters/{position}?region=global&type=ranked&tier=emerald_plus`, 시너지는 `.../synergies/{position}`도 동일 쿼리. 브라우저 Network 탭에서 화면에 보이는 승률 숫자로 응답 본문을 직접 검색해서(content search) 찾은, 실제로 데이터가 들어있는 요청입니다. 경로도 `?position=` 쿼리가 아니라 세그먼트, `region`/`type`/`tier` 없이는 통계가 안 채워지는 것도 이 과정에서 확인됨. Next.js App Router + RSC Flight 스트림(`self.__next_f.push`)인 것도 실제 페이지 소스로 검증함. 사용자가 실제 응답 본문 전체를 파일로 저장해 공유해준 덕분에, 필드명이 예상과 다르다는 것도 확인해서 고쳤습니다: 게임 수 필드는 `games`가 아니라 `play`, 챔피언 식별자는 평평한 숫자 `championId`가 없고 `champion: {key: "garen", name: "Garen", ...}`처럼 문자열 슬러그가 중첩돼 있음 — 파서가 이 중첩 슬러그를 Data Dragon 챔피언 목록과 대조해서 숫자 championId로 역매핑하도록 수정함(`src/lib/scrape.ts`의 `resolveSlug`). `patch`(패치 버전) 파라미터는 계속 바뀌는 값이라 일부러 뺐습니다 — 생략 시 최신 패치로 기본 동작하길 기대하는 것이라 아직 확정은 아님. "Champion synergies" 탭이 ADC+서포터 전용은 아니라서, 원하는 조합이 결과에 안 잡힐 수도 있음 |
| u.gg | 중간 | op.gg와 유사한 구조로 추정 |
| lolalytics | 중간 | 라인 매치업 데이터로 유명. `lane` 파라미터명 추정. "Could not find embedded page data" 에러가 났던 걸 보면 이쪽도 App Router/Flight 방식일 가능성이 있음 (op.gg와 같은 원인일 수 있음) |
| Mobalytics | 낮음 | 챔피언 슬러그가 하이픈(kebab-case)을 쓴다는 것만 어느 정도 확신, 나머지는 일반 패턴 추정 |
| DeepLoL | 낮음 | 요청하신 "deep.lol"은 아마 **deeplol.gg**를 말씀하신 것 같아 그쪽으로 연동했습니다. 도메인이 다르면 알려주세요 |
| lol.ps | 중간 | **URL과 데이터 구조 확정**: `https://lol.ps/champ/{championId}` — 슬러그가 아니라 Riot 공식 숫자 championId를 그대로 씀. op.gg와 완전히 다른 SvelteKit 사이트라 전용 어댑터로 따로 구현(`src/lib/sources/lolps.ts`, `genericSource.ts` 안 씀). 페이지에 내장된 `champSummary` 데이터에 카운터 목록이 병렬 배열(`counterChampionIdList`/`counterWinrateList`/`counterCountList`, "쉬운 상대"용 `counterEasy*` 세트)로 미리 계산되어 들어있어서 다른 소스보다 오히려 깔끔함. **알려진 제약**: 화면의 라인 탭(탑/정글/미드/바텀/서폿)을 눌러 라인을 바꾸는 게 어떤 요청으로 이루어지는지 여러 방법(쿼리 파라미터, Network 탭 전체 필터)으로도 못 찾았음 — `https://lol.ps/champ/{id}`로 요청하면 그 챔피언이 **가장 많이 가는 라인**의 데이터만 받아옴. 그래서 이 소스는 사용자가 고른 라인이 챔피언의 주 라인과 일치할 때만(응답의 `laneId`로 확인) 데이터를 보여주고, 안 맞으면 조용히 스킵함(틀린 라인 데이터를 보여주지 않기 위함). 바텀 듀오 시너지 페이지는 아직 위치를 못 찾아서 미지원 |

**공통 파싱 로직**(`src/lib/scrape.ts`)은 정확한 JSON 경로를 하드코딩하지 않고, 챔피언 식별 필드(평평한 `championId`류, 또는 op.gg처럼 `champion: {key: "..."}`형태로 중첩된 슬러그) + `winRate`/`wins`류 필드를 동시에 가진 객체가 2개 이상 들어있는 배열을 페이지의 내장 데이터에서 찾는 방식이라 필드명이 조금 달라도, 배열에 마커 값이 섞여 있어도 버틸 여지가 있지만, 근본적으로는 여전히 추정입니다. 중첩 슬러그는 각 소스가 URL을 만들 때 쓰는 것과 동일한 슬러그 변환 함수로 Data Dragon 챔피언 목록을 돌려서 역매핑합니다(`genericSource.ts`의 `buildSlugResolver`).

**로컬에서 실행해보고 안 되면** 에러 메시지를 그대로 알려주세요. API 응답에는 소스별로 어떤 이유로 실패했는지(HTTP 상태 코드 / 못 찾은 부분)가 다 담겨 있어서 바로 원인을 좁힐 수 있습니다. 일부만 실패하는 경우 화면의 "N개 소스 중 M개 성공" 항목을 펼치면 소스별 에러가 보입니다. 카운터 페이지 하나의 실제 URL과 (가능하면) 그 페이지 소스를 공유해주시면 가장 빠르게 고칠 수 있습니다.

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
    page.tsx                # 메인 UI (라인 카운터 / 바텀 듀오 / 픽 추천 모드)
    api/champions/          # GET 챔피언 목록 (Data Dragon, 폴백 포함)
    api/counters/           # GET 챔피언+라인 → 소스별 카운터 리스트 집계
    api/duo/                # GET ADC+서포터 → 소스별 듀오 시너지 집계
    api/pickadvice/         # GET 포지션+상대 라이너/우리팀 원거리 딜러(선택) → 픽 추천 (위 두 집계 재사용)
  components/
    ChampionPicker.tsx, ChampionIcon.tsx, WinRateBar.tsx
    SourceBreakdown.tsx      # "op.gg 54% (320게임) · u.gg 52% (150게임)" 배지
  lib/
    ddragon.ts               # Data Dragon 클라이언트 (+ 오프라인 폴백)
    positions.ts             # 라인(포지션) 목록/타입
    cache.ts                 # 짧은 TTL 인메모리 캐시
    scrape.ts                # 공통 HTML fetch + 내장 JSON 파싱/탐색 유틸
    sources/
      types.ts               # StatSource 인터페이스
      genericSource.ts        # 사이트 설정 → StatSource 팩토리
      registry.ts             # 6개 사이트 설정 (여기서 URL/슬러그 규칙 수정)
      lolps.ts                 # lol.ps 전용 어댑터 (genericSource로 안 되는 구조라 직접 구현)
      aggregate.ts             # 여러 소스를 챔피언별로 합치고 상위 3개만 추림 (라인 카운터 + 듀오 후보 목록 둘 다)
data/fallback-champions.json # Data Dragon 접근 불가 시 쓰는 오프라인 챔피언 스냅샷
```

## 새 사이트 추가하는 법

`src/lib/sources/registry.ts`의 `configs` 배열에 항목을 하나 추가하면 됩니다:

```ts
{
  id: "newsite",
  label: "새사이트",
  confidence: "low",
  slug: (s) => s.toLowerCase(), // 또는 toKebabSlug 등
  counterUrl: (slug, position) => `https://example.com/champions/${slug}/counters?position=${position}`,
  duoUrl: (adcSlug) => `https://example.com/champions/${adcSlug}/duos?position=adc`,
},
```

그 사이트가 Next.js/Nuxt 계열로 서버 렌더링되며 페이지에 통계 배열이 JSON으로 내장돼 있다면 이걸로 끝입니다. 완전히 다른 방식(별도 JSON API 등)을 쓰는 사이트라면 `src/lib/sources/types.ts`의 `StatSource` 인터페이스를 직접 구현하는 새 파일을 만들고 `registry.ts`의 `SOURCES` 배열에 추가하세요.

## 알려진 제한사항

- **소스별 페이지 구조 미검증** (위 "각 소스 연동 신뢰도" 표 참고) — 가장 먼저 확인이 필요한 부분입니다.
- 인메모리 캐시는 서버리스/재배포 환경에서 인스턴스마다 따로 놀고 쉽게 초기화됩니다. 완전히 신뢰할 캐시가 필요하면 Redis 등 외부 캐시로 바꾸는 걸 권장합니다.
- 어떤 사이트가 요청을 차단(403/429)하면 그대로 에러로 보여줍니다 — 우회를 시도하지 않습니다. 반복적으로 막힌다면 조회 빈도를 줄이거나 해당 사이트에 이용 허가를 문의하는 걸 권장합니다.
- 5개 챔피언 전체 조합 평가, 아이템 빌드 추천처럼 이 사이트들의 카운터/듀오 페이지에 없는 통계는 제공하지 않습니다 (실제 존재하는 데이터만 보여주는 쪽으로 방향을 잡았습니다).
