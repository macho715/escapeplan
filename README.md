# UrgentDash Independent (독립 운영)

HYIE 전황 실시간 모니터링. 백엔드 포함, 30분마다 업데이트. 정보 소스: NotebookLM.

## 실행

### API + UI (통합)
```powershell
.\start_local_dashboard.ps1
# API: http://127.0.0.1:8000/api/state
# UI:  http://127.0.0.1:3000/ui/index_v2.html
```

### React (Vite)
```bash
cd react && npm install && npm run dev
```

### 30분 파이프라인
- **GHA**: .github/workflows/monitor.yml (cron 7,37)
- **로컬**: `python scripts/run_monitor.py`

## 필수
- Python 3.11+, Node.js
- NotebookLM (nlm login, NLM_COOKIES_JSON)
- requirements.txt
