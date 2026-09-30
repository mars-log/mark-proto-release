# 배포 작업 지침

- 원격은 `isunz/mark-proto-release`, 작업 공간의 로컬 경로는 `release/`임. [저장소·폴더 명명 정책](../doc/policies/repository/README.md)에 따라 독립 Git·이력을 보존함. 단독 clone이면 총괄 저장소의 같은 정책을 확인함.

- 작업 전 isunz/mark-proto-space의 doc/policies/development/README.md와 doc/policies/release/README.md를 읽고 적용함. 형제 checkout이면 ../doc/policies/에서 확인함. 원본을 추정하거나 다른 작업 중 정책을 교체하지 않음.
- 설치 파일·서명·배포 메타데이터만 공개함. private source·개인키·개인 토큰·운영 설정을 커밋하지 않음.
- app을 먼저 커밋·푸시하고 래퍼 pin을 갱신함. Mac 로컬/Windows CI, Windows 로컬/Mac CI 규칙을 유지함. 웹 서버는 자동 배포·재시작하지 않음.
- 채널은 파일 업로드 완료 후 갱신함. 버전 감소·태그/설치 파일 덮어쓰기를 금지함. 미검증 플랫폼의 설치 성공을 주장하지 않음.

- 로그인 유지·앱 잠금·PIN·잠금 화면 테마 변경 전 [공통 세션·잠금 정책](../doc/policies/session-lock/README.md)을 반드시 읽고 적용함. Windows·Mac·회사 PC 등 작업 기기 및 AI 제품·세션과 관계없이 적용함. 단독 clone이면 `mars-log/mark-proto-space`의 `doc/policies/session-lock/README.md` 원본을 확인함. 정책을 복제·추정하지 않고 구현·검증·배포 상태를 구분함.
