# 골목 맛집 수첩

지도에서 기준 위치를 정하면 반경 3km 안의 맛집을 보여 주는 맛집 추천 페이지 초안입니다.

## 기능
- 네이버 지도 / 카카오맵 전환
- 지도 클릭, 주소·장소 검색, 내 위치로 기준 위치 설정 → 반경 3km 필터
- 종류 · 인원수 · 1인 가격(1만원 단위, 5만원까지) 필터, 검색
- 가게별 네이버 · 카카오 평점과 리뷰 수 표시, 평점·거리·가격순 정렬

## 파일
- `index.html` — 지도 연동 버전 (메인)
- `claude-artifact-draft.html` — 지도 없는 초기 초안 (Claude 아티팩트용)

## 설정
`index.html` 위쪽에 키를 넣으세요. 하나만 넣어도 그 지도는 동작합니다.

```js
const NAVER_KEY_ID = "YOUR_NAVER_CLIENT_ID";      // 네이버 클라우드 플랫폼 · Maps Client ID
const KAKAO_JS_KEY = "YOUR_KAKAO_JAVASCRIPT_KEY"; // 카카오 디벨로퍼스 · JavaScript 키
```

- 네이버: Application 등록에서 Maps 선택 → Web 서비스 URL에 배포 주소 등록
- 카카오: 앱 생성 → 플랫폼 Web 사이트 도메인 등록 → 카카오맵 사용 설정 ON
- 로컬 테스트는 `http://localhost`를 등록한 뒤 `npx serve .` 등으로 띄우면 됩니다.

## 데이터
가게 정보, 좌표, 평점은 모두 **예시 데이터**입니다. `index.html`의 `DATA` 배열을 실제 정보로 바꿔 주세요.
평점은 공식 API가 없어 각 가게의 `naver: {score, count}`, `kakao: {score, count}` 값을 직접 입력합니다.
