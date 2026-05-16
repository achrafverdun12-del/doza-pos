# Doza Coffee POS - Phase 4

Enterprise-grade cash POS for Doza Coffee with realtime multi-terminal sync.

## Delivered Features
- Full backend API with SQLite persistence
- Hashed PIN auth + JWT sessions
- Role-based authorization (cashier, manager, admin)
- Shift open/close + drawer reconciliation
- Transactional order processing and stock deduction
- Inventory management + admin menu creation
- Daily CSV report export
- Daily PDF end-of-day report export
- Realtime state sync over Socket.IO across terminals
- Thermal-style receipt print layout

## Stack
- Backend: Express, Socket.IO, better-sqlite3, bcryptjs, jsonwebtoken, pdfkit
- Frontend: Vanilla HTML/CSS/JS served from `public/`

## Run
1. Install dependencies:
   - `npm install`
2. Start server:
   - `npm start`
3. Open POS:
   - `http://localhost:5050`

## Default Staff Credentials
- Cashier: Nadia / `1111`
- Manager: Youssef / `2222`
- Admin: Admin / `9999`

## Reports
- CSV endpoint: `/api/reports/daily.csv?date=YYYY-MM-DD`
- PDF endpoint: `/api/reports/daily.pdf?date=YYYY-MM-DD`
- Both require manager auth token.

## Production Note
Set your own JWT secret before deployment:
- PowerShell: `$env:DOZA_JWT_SECRET="your-strong-secret"`
