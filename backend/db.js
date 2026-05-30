const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

const defaultData = {
  users: [
    { id: 1, name: 'Admin', email: 'admin@example.com', password: '$2b$10$dQBxLD2905nZlSx5nDBO6eu/zKHVg0h8ZOdowmXvqKp7nD9Ek6TX6', role: 'admin' }
  ],
  contacts: [],
  campaigns: [],
  messages: [],
  chats: [],        // incoming/outgoing chat messages per contact
  templates: [],    // saved message templates
  chatbot: {
    enabled: false,
    welcomeMsg: '',
    fallbackMsg: '',
    rules: []
  },
  flows: [],           // conversation flow definitions
  flowSessions: {},    // { phone: { flowId, nodeId, startedAt, lastAt } }
  settings: {
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
    apiVersion: 'v20.0',
    webhookToken: ''
  }
};

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // Migrations: ensure new keys exist
  if (!data.chats) data.chats = [];
  if (!data.templates) data.templates = [];
  if (!data.chatbot) data.chatbot = { enabled: false, welcomeMsg: '', fallbackMsg: '', rules: [] };
  if (!data.chatbot.rules) data.chatbot.rules = [];
  if (!data.flows) data.flows = [];
  if (!data.flowSessions) data.flowSessions = {};
  return data;
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getDB() {
  return loadDB();
}

module.exports = { getDB, saveDB };
