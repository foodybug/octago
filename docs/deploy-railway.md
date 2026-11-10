# OCTAGO 공용 서버 배포

게임 화면과 랭킹 API를 하나의 Railway 서비스에 배포한다. 모든 플랫폼은 배포 후 발급되는 동일한 HTTPS 주소를 사용한다.

## 준비된 구성

- `Dockerfile`: Node.js 24, 실행용 외부 패키지 없이 `node server.cjs` 실행.
- `railway.json`: Docker 빌드, 단일 서버, `/api/health` 상태 확인, 오류 시 최대 5회 재시작.
- 필수 영구 볼륨 마운트 경로: `/data`. `requiredMountPath`로 볼륨 연결을 배포 조건에 포함한다.
- 기록 파일: `/data/leaderboard.json`. 이미지와 소스 묶음에는 기존 랭킹 데이터나 인증 정보를 포함하지 않는다.
- 이전 배포와의 실행 중첩은 0초로 설정한다. 같은 파일을 여러 서버 프로세스가 동시에 갱신하지 않도록 서버 수는 1개로 유지한다.

## 계정 연결 후 구성할 자원

1. Railway 계정에 로그인하고 OCTAGO 전용 프로젝트와 `octago` 서비스를 생성한다.
2. 서비스에 영구 Volume을 연결하고 마운트 경로를 `/data`로 지정한다.
3. 아래 환경변수를 확인한다. Docker 이미지에도 동일한 기본값이 포함되어 있다.

   | 변수 | 값 |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `HOST` | `0.0.0.0` |
   | `LEADERBOARD_FILE` | `/data/leaderboard.json` |

4. `RANKING_API_URL`은 비워 둔다. 화면과 API를 함께 배포하므로 별도 CORS 설정 없이 같은 주소를 사용한다.
5. 배포 소스를 업로드하고 빌드·상태 확인이 성공할 때까지 확인한다.
6. 서비스의 Public Networking에서 Railway HTTPS 도메인을 생성하고 실제 서버 포트에 연결한다. `PORT`가 설정되어 있으면 서버가 그 값을 사용하며 기본값은 3000이다.
7. 발급된 HTTPS 주소에서 타이틀·랭킹 조회·게임 종료 후 저장·다른 브라우저의 기록 조회를 확인한다.

계정의 사용 가능한 플랜과 결제 상태는 연결 후 확인한다. 도메인, 프로젝트 ID, 서비스 ID는 실제 생성 결과를 사용한다.

## 배포 소스 준비

```powershell
npm.cmd test
npm.cmd run package:server
```

두 번째 명령은 실행에 필요한 13개 파일만 `artifacts/railway-<UUID>/`에 복사한다. 최신 경로와 각 파일의 SHA-256은 `artifacts/railway-package.json`에 기록된다. 배포 도구에 이 디렉터리를 전달한다. `node_modules`, 테스트 결과, 브라우저 개인 기록, 로컬 랭킹 파일, `.env`와 클라우드 인증 정보는 포함하지 않는다.

Docker가 설치된 환경에서 컨테이너를 직접 확인하려면:

```powershell
docker build -t octago .
docker volume create octago-records
docker run --rm --name octago -p 3001:3000 -v octago-records:/data octago
```

`http://localhost:3001`에서 확인한다. 컨테이너를 다시 만들어도 같은 볼륨을 연결하면 기록을 유지한다. Railway에서 생성한 영구 볼륨도 같은 방식으로 사용한다.

## 운영 확인

- `GET /api/health`: 서버 상태 확인.
- `GET /api/leaderboard`: 여러 기기가 공유하는 랭킹.
- `POST /api/scores`: 시드·발동 내역을 검증한 게임 종료 기록 저장.
- 기록 백업은 Railway Volume의 백업 기능이나 `/data/leaderboard.json` 파일 백업을 사용한다. 기존 볼륨은 다음 배포에서도 유지한다.

참고: [Railway 배포 설정](https://docs.railway.com/config-as-code/reference), [영구 볼륨](https://docs.railway.com/volumes), [공용 네트워크](https://docs.railway.com/networking/public-networking).
