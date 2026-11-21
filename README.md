# RoutePass — 다도시 여행 일정·이동·출입국 확인 웹 앱

방문할 도시를 순서대로 넣으면

1. **AI(Gemini)** 가 도시별 하루 일정과 구간별 이동수단 후보를 만들고
2. 각 이동수단이 **지금도 운행하는지** 출처와 함께 확인하고 (예: 알레그로 열차 → 운행 중단)
3. 항공권 가격을 모아 **최저가·최단시간 경로**를 계산하고 (환승·별도 발권 포함)
4. **체류일 합산·비자·외교부 여행경보**로 출입국 조건을 검사합니다.

출발·귀국은 인천이며, `data/incheon-routes.json`의 인천 노선표(운휴 포함)를 기준으로 직항 여부를 판단합니다.

## 빠르게 실행하기 (키 없이 데모)

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:3000 을 열고 **일정 만들기**를 누르면 예시 여정(서울 → 모스크바 → 상트페테르부르크 → 탈린 → 헬싱키 → 서울)이 나옵니다.
데모 모드에서도 운행 확인(저장된 사례), 식당 찾기(OpenStreetMap), 출입국 계산, 최저가 계산(예시 가격)은 실제로 동작합니다.

## API 키 넣기

`.env.example`을 복사해 `.env.local`을 만들고 키를 채운 뒤 개발 서버를 다시 켜세요.
**`.env.local`은 GitHub에 올라가지 않습니다 (.gitignore에 포함). 키를 코드에 직접 쓰지 마세요.**

| 변수 | 어디서 받나 | 무료 한도 | 없으면 |
|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio (aistudio.google.com) | 무료 등급 (요청 수 제한) | 예시 여정만 가능 |
| `TAVILY_API_KEY` | app.tavily.com | 월 1,000 크레딧, 카드 불필요 | 저장된 사례만 판정, 나머지 "확인 불가" |
| `SERPAPI_KEY` | serpapi.com | 월 250회 | 실시간 가격 버튼 비활성 |
| `TRAVELPAYOUTS_TOKEN` | travelpayouts.com 가입 → Aviasales 프로그램 연결 | 무료 (캐시 가격) | 예시 가격 |
| `DATA_GO_KR_KEY` | 공공데이터포털 → "외교부_국가∙지역별 여행경보제도" 활용신청 | 무료 (개발계정 자동승인) | 저장된 여행금지 데이터만 사용 |

- Gemini 무료 등급은 입력 내용이 제품 개선에 쓰일 수 있습니다. **실명·연락처·여권번호 같은 개인정보를 넣지 마세요.** 이 앱은 개인정보를 입력받지 않습니다.
- SerpApi는 쿼터가 작아서 **"실시간 가격 확인" 버튼을 눌렀을 때만** 호출합니다.
- 외교부 API는 응답 필드 문서가 부족합니다. 키를 받으면 `npm run mofa-probe RU`로 실제 응답을 확인하고 `lib/server/mofa.ts`를 맞추세요.

## 테스트와 실험

```bash
npm test            # 핵심 규칙 테스트 (체류일, 여행금지, 노선표, 운행 매칭, 최저가 경로, 출입국) — 키 불필요
npm run typecheck   # 타입 검사
npm run experiment  # 비교 실험: AI 단독 vs 검색+AI (GEMINI, TAVILY 키 필요)
```

`npm run experiment`는 `data/eval/transport-status.json`의 정답 세트로 실험하고 `experiments/results-날짜.csv`를 만듭니다.
정답 세트는 지금 출처로 확인한 3건만 있으니, **팀에서 20건 정도로 늘려야** 보고서에 쓸 만한 결과가 나옵니다.

## Vercel 배포

1. GitHub에 올립니다 (`.env.local`이 안 올라갔는지 꼭 확인).
2. Vercel에서 저장소를 가져오고, Project Settings → Environment Variables에 위 키들을 넣습니다.
3. 배포 후 `/api/status`를 열어 키 연결 상태를 확인합니다.

## 폴더 구조

```
app/                화면(page.tsx)과 서버 API(app/api/*)
components/         화면 조각 (입력폼, 노선도, 도시·이동 카드, 경로 비교, 출입국, 지도)
lib/                브라우저·서버 공용 로직 (최저가 경로, 출입국 규칙, 노선표, 날짜)
lib/server/         서버 전용 (Gemini, 검색, 항공, 외교부, 식당, 일정 생성)
data/               노선표, 도시, 나라, 출입국 규칙, 여행금지, 운행 사례, 데모, 정답 세트
tests/              자동 테스트
scripts/            비교 실험, 외교부 API 확인
docs/               모듈 설명서, AI 사용 로그
```

모듈별 설명과 팀원 분담안은 `docs/MODULES.md`를 보세요.

## 데이터 출처

- 인천 노선표: 팀이 제공한 노선표 이미지 (2026-11-21 기준, 취소선 = 운휴)
- 운행 사례: VR(핀란드 철도), Baltic Shuttle 공식 사이트 — `data/transport-kb.json`에 링크
- 출입국: EU 집행위원회(EES·ETIAS), 외교부 여행경보 정기 조정(2026-07-10) 등 — `data/entry-rules.json`, `data/travel-bans.json`에 링크
- 지도·식당: © OpenStreetMap 기여자 (ODbL)
- 항공 가격: Travelpayouts(Aviasales 캐시), SerpApi(Google Flights 결과)
