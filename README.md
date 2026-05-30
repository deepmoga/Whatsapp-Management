# WA Bulk Sender v2.0

WhatsApp Bulk Messaging System – Node.js + Vanilla HTML

## ✨ New in v2.0
- 💬 **Chat / Inbox Page** – Real-time conversation view, send/receive messages per contact
- 📝 **Templates Page** – Save, categorize, and reuse message templates across campaigns and chats
- ➕ **Add Contact** manually from Contacts page
- 🔔 **Unread badge** on Chat nav item
- 📲 **Webhook support** – Incoming messages auto-stored in inbox
- 🔁 **{{name}} / {{phone}}** variable substitution in campaigns
- 🚀 **Template quick-use** in Send page dropdown
- 💬 **Chat from Contacts page** – one click to open chat with any contact

## 📁 Project Structure
```
wabulk/
├── backend/
│   ├── server.js          # Express API + WhatsApp logic
│   ├── db.js              # JSON file database
│   ├── .env               # Environment variables
│   └── package.json
└── frontend/
    └── index.html         # Single-file frontend (all pages)
```

## 🚀 Setup

### Backend
```bash
cd backend
npm install
node server.js
```

### Frontend
Open `frontend/index.html` directly in browser, or serve via backend (see below).

---

## 🌐 API Endpoints

### Auth
- `POST /api/login` – Login
- `PUT  /api/profile` – Update profile

### Contacts
- `GET    /api/contacts` – List (search, status, page)
- `POST   /api/contacts/add` – Add single contact
- `POST   /api/contacts/import` – Import Excel/CSV
- `DELETE /api/contacts/:id` – Delete one
- `DELETE /api/contacts` – Clear all

### Templates
- `GET    /api/templates` – List all
- `POST   /api/templates` – Create
- `PUT    /api/templates/:id` – Update
- `DELETE /api/templates/:id` – Delete

### Chat
- `GET  /api/chats` – All thread list
- `GET  /api/chats/:phone` – Messages for a phone
- `POST /api/chats/:phone/send` – Send message to phone

### Campaigns
- `GET  /api/campaigns` – List
- `POST /api/campaigns` – Create & launch
- `PUT  /api/campaigns/:id/pause`
- `PUT  /api/campaigns/:id/resume`
- `PUT  /api/campaigns/:id/cancel`

### Settings
- `GET  /api/settings`
- `PUT  /api/settings`
- `POST /api/settings/test`

### Webhook (for incoming messages)
- `GET  /api/webhook` – Verification
- `POST /api/webhook` – Receive messages

### Stats
- `GET /api/stats`

---

## ⚙️ Environment Variables (.env)
```
PORT=5000
JWT_SECRET=wabulk-super-secret-key-2025-change-this
NODE_ENV=development
```

## 🔐 Default Login
- Email: `admin@example.com`
- Password: `admin123`

## 📊 Excel Format
Column `phone_number` (required), `name` (optional)

## 💡 Message Variables
Use `{{name}}` and `{{phone}}` in text messages – auto-replaced per contact.

## 🪝 Webhook Setup
1. Set Webhook Verify Token in Settings
2. In Meta Developer Console, set webhook URL to:
   `https://yourdomain.com/api/webhook`
3. Subscribe to `messages` field
