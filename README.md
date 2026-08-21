# semips — LoL 챔피언 조합 추천

리그 오브 레전드 **공식 Riot API**로 수집한 실제 매치 데이터를 기반으로 챔피언 조합을 추천하는 웹 앱입니다.

- **챔피언 1~4개 입력 → 남은 자리 추천**: 고른 챔피언들과 같은 팀일 때 승률이 높았던 챔피언을 추천합니다.
- **5인 조합 평가 + 카운터 추천**: 완성된 팀 조합의 시너지 승률을 평가하고, 그 조합을 상대하기 좋은 개별 챔피언과 카운터 5인 조합을 추천합니다.

> op.gg, u.gg 같은 제3자 전적 사이트는 스크래핑하지 않습니다. 모든 데이터는 Riot의 공식 API(developer.riot.com)로만 수집합니다.

## 기술 스택

- Next.js (App Router, TypeScript) — 프론트엔드 + API 라우트를 한 앱으로
- Prisma + SQLite — 챔피언/시너지·매치업 통계 저장
- Riot API (League-V4, Match-V5) — 매치 데이터 수집
- Data Dragon — 챔피언 이름/아이콘 등 정적 데이터

## 동작 원리

1. `scripts/collectMatches.ts`가 상위 티어(챌린저/그마/마스터) 랭크 게임 매치를 Riot API로 수집합니다.
2. 매치마다 같은 팀 챔피언 쌍의 승/패를 `ChampionPairStat`(시너지)에, 상대 팀 챔피언 쌍의 승/패를 `ChampionMatchupStat`(카운터)에 누적합니다.
3. 추천 시에는 베이지안 스무딩(`src/lib/synergy.ts`)으로 표본이 적은 조합이 50%로 과도하게 쏠리지 않도록 보정한 뒤 승률순으로 정렬합니다.

## 시작하기

```bash
npm install
cp .env.example .env   # DATABASE_URL은 기본값 그대로 두면 됩니다
npx prisma migrate dev # DB 스키마 적용 (최초 1회, 또는 스키마 변경 시)
npm run db:sync-champions  # Data Dragon에서 챔피언 목록/아이콘 동기화
```

챔피언 목록만 있으면 앱은 뜨지만, 추천을 받으려면 시너지/매치업 통계가 필요합니다. 아래 둘 중 하나를 선택하세요.

### A) 데모용 샘플 데이터로 바로 써보기

```bash
npm run db:seed-sample
npm run dev
```

`db:seed-sample`은 실제 매치 데이터 없이도 앱을 시연할 수 있도록 챔피언 태그 기반 휴리스틱 + 랜덤 노이즈로 그럴듯한 통계를 만들어 넣습니다(진짜 승률이 아닙니다).

### B) 실제 Riot API로 데이터 수집하기

1. https://developer.riot.com/ 에서 **Personal API Key**를 발급받습니다 (24시간마다 재발급 필요).
2. `.env`의 `RIOT_API_KEY`에 붙여넣습니다.
3. 수집을 실행합니다.

```bash
npm run collect -- --platform kr --tier challenger --max-matches 200
npm run dev
```

- `--platform`: `kr`, `na1`, `euw1` 등 (`src/lib/riot.ts`의 `Platform` 참고)
- `--tier`: `challenger` | `grandmaster` | `master`
- `--max-matches`: 이번 실행에서 처리할 매치 수
- `--delay-ms`: 요청 사이 대기시간(기본 1300ms). 개인 API 키의 레이트리밋(초당 약 20건, 2분당 100건)을 지키기 위한 값이라 낮추지 않는 것을 권장합니다.

챌린저/그마/마스터 랭커들의 최근 매치에서 시작해, 매치에 등장한 다른 플레이어들로 점점 뻗어나가며(snowball) 수집합니다. `npm run collect`를 여러 번 반복 실행할수록 통계가 쌓여 추천 품질이 좋아집니다. 이미 처리한 매치는 건너뜁니다.

개인 키는 24시간마다 만료되니, 꾸준히 데이터를 쌓으려면 매일 새 키를 발급받아 `.env`를 갱신하거나, Riot의 프로덕션 키를 신청하세요.

## Vercel 배포

Riot의 **Production API Key**(만료 없는 키) 신청서에는 실제로 접속 가능한 Product URL을 적어야 합니다. 아래대로 하면 Vercel에 무료로 배포해 URL을 만들 수 있습니다.

1. https://vercel.com 에서 GitHub 계정으로 로그인 → **Add New → Project** → 이 저장소(`jake3512/semips`) import
2. **Environment Variables**에 아래를 추가 (Production/Preview/Development 전체 체크):
   - `DATABASE_URL` = `file:./dev.db`
3. **Deploy** 클릭

Vercel은 `vercel-build`라는 스크립트가 있으면 `build` 대신 그걸 실행합니다(Vercel의 표준 관례). 이 프로젝트의 `vercel-build`는 다음을 순서대로 합니다:

```
prisma generate → prisma migrate deploy → 챔피언 동기화(Data Dragon) → 데모 샘플 데이터 시드 → next build
```

즉 **배포될 때마다 새 SQLite 파일을 만들고 데모용 합성 통계로 채웁니다.** RIOT_API_KEY 없이도 빌드/배포가 됩니다.

### 왜 SQLite인데 서버리스에서 되나요?

Vercel의 서버리스 함수는 배포 번들이 읽기 전용이라 SQLite처럼 파일에 쓰는 DB는 원래 까다롭습니다. 이 프로젝트는:

- `next.config.ts`의 `outputFileTracingIncludes`로 빌드 시 만들어진 `prisma/dev.db`를 API 라우트 번들에 강제로 포함시키고,
- `src/lib/db.ts`가 (Vercel 환경일 때만) 이 읽기전용 파일을 함수의 `/tmp`(쓰기 가능한 임시 공간)로 콜드스타트 시 한 번 복사해서 그 경로로 Prisma를 연결합니다.

로컬 개발/테스트에서는 정상 동작을 확인했지만, **실제 Vercel 인프라에는 이 세션에서 배포·검증할 방법이 없어** 100% 검증되지는 않았습니다. 배포 후 API가 500 에러를 내면 알려주시면 바로 봐드릴게요.

> 이 방식은 "지금 당장 데모용 URL이 필요하다"는 목적에 맞춘 임시방편입니다. 재배포할 때마다 데이터가 합성 샘플로 초기화되고, `npm run collect`로 모은 실제 데이터는 로컬에만 남습니다. 나중에 실제 서비스로 키우실 거면 Postgres(Vercel Postgres, Neon 등)나 Turso(libSQL) 같은 호스팅 DB로 옮기는 걸 권장드립니다 — 필요하시면 마이그레이션 도와드릴게요.

## 스크립트

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` / `npm run start` | 프로덕션 빌드 / 실행 |
| `npm run lint` | ESLint |
| `npm run db:sync-champions` | Data Dragon에서 챔피언 목록 동기화 (오프라인이면 `data/fallback-champions.json`으로 대체) |
| `npm run db:seed-sample` | 데모용 합성 통계 생성 |
| `npm run collect -- [옵션]` | Riot API로 실제 매치 데이터 수집 |
| `npm run db:migrate` | Prisma 마이그레이션 |
| `npm run vercel-build` | Vercel 배포용 빌드 (DB 생성 + 챔피언 동기화 + 샘플 시드 + next build) |

## 폴더 구조

```
src/
  app/
    page.tsx                     # 메인 UI (챔피언 선택 + 결과)
    api/champions/               # GET  챔피언 목록
    api/recommend/teammates/     # POST 1~4개 → 남은 자리 추천
    api/recommend/comp/          # POST 5인 조합 → 평가 + 카운터 추천
  components/                    # ChampionPicker, ChampionIcon, WinRateBar
  lib/
    db.ts                        # Prisma client
    ddragon.ts                   # Data Dragon 클라이언트
    riot.ts                      # Riot API 클라이언트 (레이트리밋/재시도 포함)
    synergy.ts                   # 추천 알고리즘 (베이지안 스무딩, 팀 구성 등)
scripts/
  collectMatches.ts              # 매치 수집 파이프라인
  syncChampions.ts                # 챔피언 정적 데이터 동기화
  seedSampleData.ts               # 데모용 샘플 데이터 생성
data/fallback-champions.json     # Data Dragon 접근 불가 시 쓰는 오프라인 챔피언 스냅샷
prisma/schema.prisma             # DB 스키마
```

## 알려진 제한사항

- 개인 Riot API 키는 레이트리밋이 낮아(초당 ~20건, 2분당 100건), 통계가 충분히 쌓이려면 `npm run collect`를 여러 날에 걸쳐 반복 실행해야 합니다.
- `data/fallback-champions.json`은 네트워크가 없는 환경에서 앱을 테스트하기 위한 챔피언 목록 스냅샷이며, 최신 챔피언이 누락되었거나 정보가 오래되었을 수 있습니다. 네트워크가 되는 환경에서는 항상 `npm run db:sync-champions`가 우선하며 Data Dragon의 최신 데이터로 덮어씁니다.
- 5인 조합 평가는 실제로 관측된 5인 조합 자체의 표본이 거의 없기 때문에, 조합 내 모든 페어(10쌍)의 평균 시너지 승률로 근사합니다.
