require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getDB, saveDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'wabulk-secret-2025';

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });
const imgUpload = multer({ dest: 'images/', limits: { fileSize: 5 * 1024 * 1024 } });

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('images')) fs.mkdirSync('images');

app.use('/images', express.static('images'));

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token nahi mila' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── AUTH ROUTES ───────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const db = getDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Email galat hai' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Password galat hai' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.put('/api/profile', auth, async (req, res) => {
  const { name, email, password } = req.body;
  const db = getDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User nahi mila' });
  db.users[idx].name = name || db.users[idx].name;
  db.users[idx].email = email || db.users[idx].email;
  if (password) db.users[idx].password = await bcrypt.hash(password, 10);
  saveDB(db);
  res.json({ success: true });
});

// ─── SETTINGS ROUTES ──────────────────────────────────────────────────────────
app.get('/api/settings', auth, (req, res) => {
  const db = getDB();
  res.json(db.settings);
});

app.put('/api/settings', auth, (req, res) => {
  const db = getDB();
  db.settings = { ...db.settings, ...req.body };
  saveDB(db);
  res.json({ success: true });
});

app.post('/api/settings/test', auth, async (req, res) => {
  const db = getDB();
  const { phoneNumberId, accessToken, apiVersion } = db.settings;
  if (!phoneNumberId || !accessToken) return res.status(400).json({ error: 'API credentials set nahi hain Settings mein' });
  try {
    const r = await axios.get(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 }
    );
    res.json({ success: true, phone: r.data.display_phone_number || r.data.id });
  } catch (e) {
    res.status(400).json({ error: e.response?.data?.error?.message || 'Connection fail hoya' });
  }
});

// ─── CONTACTS ROUTES ──────────────────────────────────────────────────────────
app.get('/api/contacts', auth, (req, res) => {
  const db = getDB();
  const { search, status, page = 1, limit = 50 } = req.query;
  let list = db.contacts;
  if (search) list = list.filter(c => c.phone.includes(search) || (c.name || '').toLowerCase().includes(search.toLowerCase()));
  if (status) list = list.filter(c => c.status === status);
  const total = list.length;
  const start = (page - 1) * limit;
  res.json({ contacts: list.slice(start, start + parseInt(limit)), total, page: parseInt(page) });
});

app.post('/api/contacts/import', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File nahi mili' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const db = getDB();
    let added = 0, skipped = 0, errors = [];
    rows.forEach((row, i) => {
      const phone = String(row.phone_number || row.phone || row.Phone || row['Phone Number'] || row.mobile || row.Mobile || '').trim().replace(/\s+/g, '');
      const name = String(row.name || row.Name || row.naam || '').trim();
      if (!phone) { errors.push(`Row ${i + 2}: phone number nahi mila`); skipped++; return; }
      const clean = phone.startsWith('+') ? phone : (phone.startsWith('91') && phone.length === 12 ? '+' + phone : '+91' + phone.replace(/^0/, ''));
      if (db.contacts.find(c => c.phone === clean)) { skipped++; return; }
      db.contacts.push({ id: uuidv4(), phone: clean, name, status: 'pending', addedAt: new Date().toISOString(), campaignCount: 0 });
      added++;
    });
    saveDB(db);
    fs.unlinkSync(req.file.path);
    res.json({ added, skipped, errors: errors.slice(0, 5), total: db.contacts.length });
  } catch (e) {
    res.status(400).json({ error: 'File parse nahi hoi: ' + e.message });
  }
});

app.post('/api/contacts/add', auth, (req, res) => {
  const { phone, name } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number zaroori hai' });
  const db = getDB();
  const clean = phone.startsWith('+') ? phone : (phone.startsWith('91') && phone.length === 12 ? '+' + phone : '+91' + phone.replace(/^0/, ''));
  if (db.contacts.find(c => c.phone === clean)) return res.status(400).json({ error: 'Contact pehle se exist karda hai' });
  const contact = { id: uuidv4(), phone: clean, name: name || '', status: 'pending', addedAt: new Date().toISOString(), campaignCount: 0 };
  db.contacts.push(contact);
  saveDB(db);
  res.json({ success: true, contact });
});

app.delete('/api/contacts/:id', auth, (req, res) => {
  const db = getDB();
  db.contacts = db.contacts.filter(c => c.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

app.delete('/api/contacts', auth, (req, res) => {
  const db = getDB();
  db.contacts = [];
  saveDB(db);
  res.json({ success: true });
});

// ─── IMAGE UPLOAD ─────────────────────────────────────────────────────────────
app.post('/api/upload-image', auth, imgUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image nahi mili' });
  const ext = path.extname(req.file.originalname) || '.jpg';
  const newName = uuidv4() + ext;
  const newPath = path.join('images', newName);
  fs.renameSync(req.file.path, newPath);
  res.json({ url: `/images/${newName}`, filename: req.file.originalname });
});

// ─── TEMPLATES ROUTES ─────────────────────────────────────────────────────────
app.get('/api/templates', auth, (req, res) => {
  const db = getDB();
  res.json(db.templates || []);
});

app.post('/api/templates', auth, (req, res) => {
  const { name, category, messageType, messageText, imageUrl, imageCaption, templateName, language } = req.body;
  if (!name) return res.status(400).json({ error: 'Template naam zaroori hai' });
  const db = getDB();
  if (!db.templates) db.templates = [];
  if (db.templates.find(t => t.name === name)) return res.status(400).json({ error: 'Eh naam pehle se exist karda hai' });
  const tpl = {
    id: uuidv4(), name, category: category || 'general',
    messageType: messageType || 'text', messageText, imageUrl, imageCaption,
    templateName, language: language || 'en',
    createdAt: new Date().toISOString(), usageCount: 0
  };
  db.templates.push(tpl);
  saveDB(db);
  res.json({ success: true, template: tpl });
});

app.put('/api/templates/:id', auth, (req, res) => {
  const db = getDB();
  if (!db.templates) db.templates = [];
  const idx = db.templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Template nahi mili' });
  db.templates[idx] = { ...db.templates[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveDB(db);
  res.json({ success: true, template: db.templates[idx] });
});

app.delete('/api/templates/:id', auth, (req, res) => {
  const db = getDB();
  if (!db.templates) db.templates = [];
  db.templates = db.templates.filter(t => t.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ─── CHAT / INBOX ROUTES ──────────────────────────────────────────────────────
// Get all chat threads (one per contact phone)
app.get('/api/chats', auth, (req, res) => {
  const db = getDB();
  if (!db.chats) db.chats = [];
  // Group by phone, get latest message per thread
  const threads = {};
  db.chats.forEach(msg => {
    if (!threads[msg.phone] || new Date(msg.createdAt) > new Date(threads[msg.phone].lastAt)) {
      threads[msg.phone] = {
        phone: msg.phone,
        name: msg.name || '',
        lastMessage: msg.text,
        lastAt: msg.createdAt,
        direction: msg.direction,
        unread: 0
      };
    }
    if (msg.direction === 'in' && !msg.read) threads[msg.phone].unread = (threads[msg.phone].unread || 0) + 1;
  });
  const list = Object.values(threads).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  res.json(list);
});

// Get messages for a specific phone
app.get('/api/chats/:phone', auth, (req, res) => {
  const db = getDB();
  if (!db.chats) db.chats = [];
  const phone = decodeURIComponent(req.params.phone);
  const msgs = db.chats.filter(m => m.phone === phone).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  // Mark as read
  msgs.forEach(m => { if (m.direction === 'in') m.read = true; });
  saveDB(db);
  res.json(msgs);
});

// Send a chat message (outgoing)
app.post('/api/chats/:phone/send', auth, async (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const { text, imageUrl, imageCaption, messageType = 'text' } = req.body;
  const db = getDB();
  if (!db.settings.phoneNumberId || !db.settings.accessToken) return res.status(400).json({ error: 'WhatsApp API settings set karo pehle' });
  
  const contact = db.contacts.find(c => c.phone === phone);
  const msgRecord = {
    id: uuidv4(), phone, name: contact?.name || '',
    direction: 'out', messageType, text,
    imageUrl, imageCaption, status: 'sending',
    createdAt: new Date().toISOString(), read: true
  };

  if (!db.chats) db.chats = [];
  db.chats.push(msgRecord);
  saveDB(db);

  // Actually send via WhatsApp API
  try {
    await sendWhatsAppMessage(db.settings, phone, messageType, text, imageUrl, imageCaption, null);
    const freshDB = getDB();
    const mIdx = freshDB.chats.findIndex(m => m.id === msgRecord.id);
    if (mIdx !== -1) { freshDB.chats[mIdx].status = 'sent'; saveDB(freshDB); }
    res.json({ success: true, message: { ...msgRecord, status: 'sent' } });
  } catch (e) {
    const freshDB = getDB();
    const mIdx = freshDB.chats.findIndex(m => m.id === msgRecord.id);
    if (mIdx !== -1) { freshDB.chats[mIdx].status = 'failed'; freshDB.chats[mIdx].error = e.response?.data?.error?.message || e.message; saveDB(freshDB); }
    res.status(400).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// Webhook: receive incoming messages from WhatsApp
app.get('/api/webhook', (req, res) => {
  const db = getDB();
  const VERIFY_TOKEN = db.settings?.webhookToken || 'wabulk-verify-token';
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/api/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        for (const msg of (value.messages || [])) {
          const db = getDB();
          if (!db.chats) db.chats = [];
          const phone = '+' + msg.from;
          const contact = db.contacts.find(c => c.phone === phone);
          const name = value.contacts?.find(c => c.wa_id === msg.from)?.profile?.name || contact?.name || '';
          let text = '';
          let messageType = msg.type;
          if (msg.type === 'text') text = msg.text?.body || '';
          else if (msg.type === 'image') text = msg.image?.caption || '[Image received]';
          else text = '[' + msg.type + ' message]';

          db.chats.push({
            id: msg.id || uuidv4(), phone, name, direction: 'in',
            messageType, text, status: 'received', read: false,
            createdAt: new Date(parseInt(msg.timestamp) * 1000).toISOString()
          });
          // Add/update contact
          if (!contact) {
            db.contacts.push({ id: uuidv4(), phone, name, status: 'pending', addedAt: new Date().toISOString(), campaignCount: 0 });
          } else if (name && !contact.name) {
            const idx = db.contacts.findIndex(c => c.phone === phone);
            if (idx !== -1) db.contacts[idx].name = name;
          }
          saveDB(db);

          // ─── FLOW ENGINE (runs first) ─────────────────────────────────────
          if (msg.type === 'text' && text) {
            const freshDB = getDB();
            const handled = await runFlowEngine(phone, text, freshDB.settings);
            if (handled) return; // Flow handled it — skip chatbot rules
          }

          // ─── CHATBOT AUTO-REPLY ───────────────────────────────────────────
          if (msg.type === 'text' && text) {
            const freshDB = getDB();
            const bot = freshDB.chatbot;
            if (bot && bot.enabled) {
              const isNewContact = !contact;
              // Welcome message for brand-new contacts
              if (isNewContact && bot.welcomeMsg) {
                setTimeout(() => sendBotReply(freshDB.settings, phone, bot.welcomeMsg), 1000);
                return;
              }
              // Match rules
              const lowerText = text.toLowerCase().trim();
              const matched = (bot.rules || []).find(r => {
                if (!r.active) return false;
                const kw = (r.keyword || '').toLowerCase().trim();
                if (!kw) return false;
                if (r.matchType === 'exact') return lowerText === kw;
                if (r.matchType === 'startsWith') return lowerText.startsWith(kw);
                return lowerText.includes(kw); // contains (default)
              });
              if (matched) {
                setTimeout(() => sendBotReply(freshDB.settings, phone, matched.reply), 1000);
              } else if (bot.fallbackMsg) {
                setTimeout(() => sendBotReply(freshDB.settings, phone, bot.fallbackMsg), 1000);
              }
            }
          }
        } // end for msg
      } // end for change
    } // end for entry
  } catch (e) { console.error('Webhook error:', e.message); }
});

async function sendBotReply(settings, phone, text) {
  if (!settings?.accessToken || !settings?.phoneNumberId) return;
  try {
    const url = `https://graph.facebook.com/${settings.apiVersion}/${settings.phoneNumberId}/messages`;
    await axios.post(url,
      { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${settings.accessToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const db = getDB();
    if (!db.chats) db.chats = [];
    db.chats.push({ id: uuidv4(), phone, direction: 'out', messageType: 'text', text, status: 'sent', createdAt: new Date().toISOString(), botSent: true });
    saveDB(db);
  } catch (e) { console.error('Bot reply error:', e.message); }
}

// ─── CHATBOT ROUTES ───────────────────────────────────────────────────────────
app.get('/api/chatbot', auth, (req, res) => {
  const db = getDB();
  res.json(db.chatbot);
});

app.put('/api/chatbot/settings', auth, (req, res) => {
  const db = getDB();
  const { enabled, welcomeMsg, fallbackMsg } = req.body;
  if (typeof enabled === 'boolean') db.chatbot.enabled = enabled;
  if (welcomeMsg !== undefined) db.chatbot.welcomeMsg = welcomeMsg;
  if (fallbackMsg !== undefined) db.chatbot.fallbackMsg = fallbackMsg;
  saveDB(db);
  res.json({ success: true, chatbot: db.chatbot });
});

app.post('/api/chatbot/rules', auth, (req, res) => {
  const db = getDB();
  const { keyword, matchType, reply } = req.body;
  if (!keyword || !reply) return res.status(400).json({ error: 'Keyword te reply zaroori hain' });
  const rule = { id: uuidv4(), keyword, matchType: matchType || 'contains', reply, active: true, createdAt: new Date().toISOString() };
  db.chatbot.rules.push(rule);
  saveDB(db);
  res.json(rule);
});

app.put('/api/chatbot/rules/:id', auth, (req, res) => {
  const db = getDB();
  const idx = db.chatbot.rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Rule nahi mili' });
  db.chatbot.rules[idx] = { ...db.chatbot.rules[idx], ...req.body };
  saveDB(db);
  res.json(db.chatbot.rules[idx]);
});

app.delete('/api/chatbot/rules/:id', auth, (req, res) => {
  const db = getDB();
  db.chatbot.rules = db.chatbot.rules.filter(r => r.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ─── FLOW BUILDER ROUTES ─────────────────────────────────────────────────────

// GET all flows
app.get('/api/flows', auth, (req, res) => {
  const db = getDB();
  res.json(db.flows || []);
});

// GET single flow
app.get('/api/flows/:id', auth, (req, res) => {
  const db = getDB();
  const flow = (db.flows || []).find(f => f.id === req.params.id);
  if (!flow) return res.status(404).json({ error: 'Flow nahi mili' });
  res.json(flow);
});

// CREATE flow
app.post('/api/flows', auth, (req, res) => {
  const db = getDB();
  const { name, triggerKeyword, description } = req.body;
  if (!name || !triggerKeyword) return res.status(400).json({ error: 'Name te trigger keyword zaroori hain' });
  const exists = (db.flows || []).find(f => f.triggerKeyword.toLowerCase() === triggerKeyword.toLowerCase());
  if (exists) return res.status(400).json({ error: 'Eh trigger keyword pehle se use ho raha hai' });
  const flow = {
    id: uuidv4(), name, triggerKeyword: triggerKeyword.toLowerCase().trim(),
    description: description || '', active: true, nodes: [],
    createdAt: new Date().toISOString()
  };
  if (!db.flows) db.flows = [];
  db.flows.push(flow);
  saveDB(db);
  res.json(flow);
});

// UPDATE flow meta (name, trigger, active)
app.put('/api/flows/:id', auth, (req, res) => {
  const db = getDB();
  const idx = (db.flows || []).findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Flow nahi mili' });
  const { name, triggerKeyword, description, active } = req.body;
  if (triggerKeyword !== undefined) {
    const dup = db.flows.find(f => f.id !== req.params.id && f.triggerKeyword.toLowerCase() === triggerKeyword.toLowerCase());
    if (dup) return res.status(400).json({ error: 'Eh trigger keyword already use ho raha hai' });
    db.flows[idx].triggerKeyword = triggerKeyword.toLowerCase().trim();
  }
  if (name !== undefined) db.flows[idx].name = name;
  if (description !== undefined) db.flows[idx].description = description;
  if (typeof active === 'boolean') db.flows[idx].active = active;
  saveDB(db);
  res.json(db.flows[idx]);
});

// DELETE flow
app.delete('/api/flows/:id', auth, (req, res) => {
  const db = getDB();
  db.flows = (db.flows || []).filter(f => f.id !== req.params.id);
  // Clear sessions for this flow
  Object.keys(db.flowSessions || {}).forEach(phone => {
    if (db.flowSessions[phone]?.flowId === req.params.id) delete db.flowSessions[phone];
  });
  saveDB(db);
  res.json({ success: true });
});

// ADD node to flow
app.post('/api/flows/:id/nodes', auth, (req, res) => {
  const db = getDB();
  const idx = (db.flows || []).findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Flow nahi mili' });
  const { type, text, conditions, nextNodeId, fallbackNodeId, delaySeconds } = req.body;
  if (!type) return res.status(400).json({ error: 'Node type zaroori hai' });
  const node = {
    id: uuidv4(), type,
    text: text || '',
    conditions: conditions || [],   // [{ match, nextNodeId }]
    nextNodeId: nextNodeId || null,
    fallbackNodeId: fallbackNodeId || null,
    delaySeconds: delaySeconds || 0
  };
  db.flows[idx].nodes.push(node);
  saveDB(db);
  res.json({ flow: db.flows[idx], node });
});

// UPDATE node
app.put('/api/flows/:id/nodes/:nodeId', auth, (req, res) => {
  const db = getDB();
  const flowIdx = (db.flows || []).findIndex(f => f.id === req.params.id);
  if (flowIdx === -1) return res.status(404).json({ error: 'Flow nahi mili' });
  const nodeIdx = db.flows[flowIdx].nodes.findIndex(n => n.id === req.params.nodeId);
  if (nodeIdx === -1) return res.status(404).json({ error: 'Node nahi mila' });
  db.flows[flowIdx].nodes[nodeIdx] = { ...db.flows[flowIdx].nodes[nodeIdx], ...req.body };
  saveDB(db);
  res.json(db.flows[flowIdx]);
});

// DELETE node
app.delete('/api/flows/:id/nodes/:nodeId', auth, (req, res) => {
  const db = getDB();
  const flowIdx = (db.flows || []).findIndex(f => f.id === req.params.id);
  if (flowIdx === -1) return res.status(404).json({ error: 'Flow nahi mili' });
  const removedId = req.params.nodeId;
  db.flows[flowIdx].nodes = db.flows[flowIdx].nodes.filter(n => n.id !== removedId);
  // Remove references to deleted node
  db.flows[flowIdx].nodes.forEach(n => {
    if (n.nextNodeId === removedId) n.nextNodeId = null;
    if (n.fallbackNodeId === removedId) n.fallbackNodeId = null;
    if (n.conditions) n.conditions.forEach(c => { if (c.nextNodeId === removedId) c.nextNodeId = null; });
  });
  saveDB(db);
  res.json(db.flows[flowIdx]);
});

// REORDER nodes (drag-drop order saved)
app.put('/api/flows/:id/reorder', auth, (req, res) => {
  const db = getDB();
  const flowIdx = (db.flows || []).findIndex(f => f.id === req.params.id);
  if (flowIdx === -1) return res.status(404).json({ error: 'Flow nahi mili' });
  const { nodeIds } = req.body; // ordered array of node IDs
  if (!Array.isArray(nodeIds)) return res.status(400).json({ error: 'nodeIds array chahida' });
  const nodeMap = {};
  db.flows[flowIdx].nodes.forEach(n => nodeMap[n.id] = n);
  db.flows[flowIdx].nodes = nodeIds.map(id => nodeMap[id]).filter(Boolean);
  saveDB(db);
  res.json(db.flows[flowIdx]);
});

// GET active sessions
app.get('/api/flows/sessions/all', auth, (req, res) => {
  const db = getDB();
  res.json(db.flowSessions || {});
});

// CLEAR a user's session
app.delete('/api/flows/sessions/:phone', auth, (req, res) => {
  const db = getDB();
  const phone = decodeURIComponent(req.params.phone);
  if (db.flowSessions) delete db.flowSessions[phone];
  saveDB(db);
  res.json({ success: true });
});

// ─── FLOW ENGINE ─────────────────────────────────────────────────────────────
async function runFlowEngine(phone, incomingText, settings) {
  const db = getDB();
  const lowerText = (incomingText || '').toLowerCase().trim();
  let session = db.flowSessions?.[phone];

  // If user is mid-flow
  if (session) {
    const flow = (db.flows || []).find(f => f.id === session.flowId && f.active);
    if (!flow) {
      // Flow deleted/deactivated — clear session
      delete db.flowSessions[phone];
      saveDB(db);
      return false;
    }
    const node = flow.nodes.find(n => n.id === session.nodeId);
    if (!node) {
      delete db.flowSessions[phone];
      saveDB(db);
      return false;
    }

    // Current node must be a condition — evaluate user's reply
    if (node.type === 'condition') {
      const matched = (node.conditions || []).find(c => {
        const kw = (c.match || '').toLowerCase().trim();
        return lowerText === kw || lowerText.includes(kw);
      });
      const nextId = matched ? matched.nextNodeId : node.fallbackNodeId;
      if (nextId) {
        await executeNodeChain(flow, nextId, phone, settings, db);
      } else {
        // No next — end flow
        delete db.flowSessions[phone];
        saveDB(db);
      }
      return true;
    }
    return false;
  }

  // Not mid-flow — check if incoming text triggers a flow
  const triggeredFlow = (db.flows || []).find(f => {
    if (!f.active || !f.nodes.length) return false;
    return lowerText === f.triggerKeyword || lowerText.includes(f.triggerKeyword);
  });
  if (!triggeredFlow) return false;

  // Start from first node
  await executeNodeChain(triggeredFlow, triggeredFlow.nodes[0]?.id, phone, settings, db);
  return true;
}

async function executeNodeChain(flow, nodeId, phone, settings, db) {
  if (!nodeId) return;
  const node = flow.nodes.find(n => n.id === nodeId);
  if (!node) return;

  if (node.type === 'message') {
    if (node.delaySeconds > 0) await new Promise(r => setTimeout(r, node.delaySeconds * 1000));
    await sendBotReply(settings, phone, node.text);
    if (node.nextNodeId) {
      const nextNode = flow.nodes.find(n => n.id === node.nextNodeId);
      if (nextNode && nextNode.type === 'message') {
        // Chain message → message automatically
        await executeNodeChain(flow, node.nextNodeId, phone, settings, db);
      } else if (nextNode && nextNode.type === 'condition') {
        // Pause and wait for user input — save session
        const freshDB = getDB();
        if (!freshDB.flowSessions) freshDB.flowSessions = {};
        freshDB.flowSessions[phone] = { flowId: flow.id, nodeId: nextNode.id, startedAt: freshDB.flowSessions[phone]?.startedAt || new Date().toISOString(), lastAt: new Date().toISOString() };
        saveDB(freshDB);
      } else if (nextNode && nextNode.type === 'end') {
        const freshDB = getDB();
        delete freshDB.flowSessions?.[phone];
        saveDB(freshDB);
      }
    } else {
      // No next — flow ended, clear session
      const freshDB = getDB();
      if (freshDB.flowSessions) delete freshDB.flowSessions[phone];
      saveDB(freshDB);
    }
  } else if (node.type === 'condition') {
    // Save session — wait for user reply
    const freshDB = getDB();
    if (!freshDB.flowSessions) freshDB.flowSessions = {};
    freshDB.flowSessions[phone] = { flowId: flow.id, nodeId: node.id, startedAt: freshDB.flowSessions[phone]?.startedAt || new Date().toISOString(), lastAt: new Date().toISOString() };
    saveDB(freshDB);
  } else if (node.type === 'end') {
    const freshDB = getDB();
    if (freshDB.flowSessions) delete freshDB.flowSessions[phone];
    if (node.text) await sendBotReply(settings, phone, node.text);
    saveDB(freshDB);
  }
}

// ─── CAMPAIGN ROUTES ──────────────────────────────────────────────────────────
app.get('/api/campaigns', auth, (req, res) => {
  const db = getDB();
  res.json(db.campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/campaigns/:id', auth, (req, res) => {
  const db = getDB();
  const camp = db.campaigns.find(c => c.id === req.params.id);
  if (!camp) return res.status(404).json({ error: 'Campaign nahi mili' });
  const msgs = db.messages.filter(m => m.campaignId === camp.id);
  res.json({ ...camp, messages: msgs });
});

app.post('/api/campaigns', auth, async (req, res) => {
  const { name, messageType, messageText, imageUrl, imageCaption, templateName, delaySeconds = 3, scheduledAt, templateId } = req.body;
  const db = getDB();

  // If templateId, fetch from saved templates
  let finalMsgType = messageType, finalText = messageText, finalImageUrl = imageUrl, finalCaption = imageCaption, finalTemplate = templateName;
  if (templateId) {
    const tpl = (db.templates || []).find(t => t.id === templateId);
    if (tpl) {
      finalMsgType = tpl.messageType;
      finalText = tpl.messageText;
      finalImageUrl = tpl.imageUrl;
      finalCaption = tpl.imageCaption;
      finalTemplate = tpl.templateName;
      // Increment usage
      const ti = db.templates.findIndex(t => t.id === templateId);
      if (ti !== -1) { db.templates[ti].usageCount = (db.templates[ti].usageCount || 0) + 1; }
    }
  }

  const contacts = db.contacts.filter(c => c.status !== 'opted_out');
  if (contacts.length === 0) return res.status(400).json({ error: 'Koi contact nahi mila. Pehle Excel import karo.' });
  if (!db.settings.phoneNumberId || !db.settings.accessToken) return res.status(400).json({ error: 'WhatsApp API settings set karo pehle.' });

  const campaign = {
    id: uuidv4(), name, messageType: finalMsgType, messageText: finalText,
    imageUrl: finalImageUrl, imageCaption: finalCaption, templateName: finalTemplate,
    delaySeconds, scheduledAt: scheduledAt || null,
    status: scheduledAt ? 'scheduled' : 'running',
    totalContacts: contacts.length, sent: 0, failed: 0, pending: contacts.length,
    createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
    createdBy: req.user.name
  };

  db.campaigns.push(campaign);
  contacts.forEach(c => {
    db.messages.push({ id: uuidv4(), campaignId: campaign.id, contactId: c.id, phone: c.phone, name: c.name, status: 'pending', sentAt: null, error: null });
  });
  saveDB(db);

  if (!scheduledAt) {
    res.json({ success: true, campaignId: campaign.id, totalContacts: contacts.length });
    runCampaign(campaign.id);
  } else {
    res.json({ success: true, campaignId: campaign.id, totalContacts: contacts.length, scheduledAt });
  }
});

async function sendWhatsAppMessage(settings, phone, msgType, text, imageUrl, imageCaption, templateName) {
  const url = `https://graph.facebook.com/${settings.apiVersion}/${settings.phoneNumberId}/messages`;
  const headers = { Authorization: `Bearer ${settings.accessToken}`, 'Content-Type': 'application/json' };
  let body = { messaging_product: 'whatsapp', to: phone };

  if (msgType === 'text') {
    body.type = 'text';
    body.text = { body: text };
  } else if (msgType === 'image') {
    body.type = 'image';
    body.image = { link: imageUrl, caption: imageCaption || '' };
  } else if (msgType === 'template') {
    body.type = 'template';
    body.template = { name: templateName, language: { code: 'en_US' } };
  }

  return axios.post(url, body, { headers, timeout: 10000 });
}

async function runCampaign(campaignId) {
  const db = getDB();
  const camp = db.campaigns.find(c => c.id === campaignId);
  if (!camp) return;
  camp.status = 'running';
  camp.startedAt = new Date().toISOString();
  saveDB(db);

  const pendingMsgs = db.messages.filter(m => m.campaignId === campaignId && m.status === 'pending');

  for (const msg of pendingMsgs) {
    const freshDB = getDB();
    const freshCamp = freshDB.campaigns.find(c => c.id === campaignId);
    if (!freshCamp || freshCamp.status === 'paused' || freshCamp.status === 'cancelled') break;

    // Replace {{name}} variable
    let personalizedText = freshCamp.messageText || '';
    if (msg.name) personalizedText = personalizedText.replace(/\{\{name\}\}/gi, msg.name);
    personalizedText = personalizedText.replace(/\{\{phone\}\}/gi, msg.phone);

    try {
      await sendWhatsAppMessage(
        freshDB.settings, msg.phone,
        freshCamp.messageType, personalizedText,
        freshCamp.imageUrl, freshCamp.imageCaption, freshCamp.templateName
      );
      const mIdx = freshDB.messages.findIndex(m => m.id === msg.id);
      freshDB.messages[mIdx].status = 'sent';
      freshDB.messages[mIdx].sentAt = new Date().toISOString();
      freshCamp.sent++;
      freshCamp.pending--;
    } catch (e) {
      const mIdx = freshDB.messages.findIndex(m => m.id === msg.id);
      freshDB.messages[mIdx].status = 'failed';
      freshDB.messages[mIdx].error = e.response?.data?.error?.message || e.message;
      freshCamp.failed++;
      freshCamp.pending--;
    }

    if (freshCamp.pending === 0) {
      freshCamp.status = 'completed';
      freshCamp.completedAt = new Date().toISOString();
    }
    saveDB(freshDB);
    await new Promise(r => setTimeout(r, (freshCamp.delaySeconds || 3) * 1000));
  }
}

app.put('/api/campaigns/:id/pause', auth, (req, res) => {
  const db = getDB();
  const c = db.campaigns.find(c => c.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign nahi mili' });
  c.status = 'paused';
  saveDB(db);
  res.json({ success: true });
});

app.put('/api/campaigns/:id/resume', auth, (req, res) => {
  const db = getDB();
  const c = db.campaigns.find(c => c.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign nahi mili' });
  c.status = 'running';
  saveDB(db);
  runCampaign(c.id);
  res.json({ success: true });
});

app.put('/api/campaigns/:id/cancel', auth, (req, res) => {
  const db = getDB();
  const c = db.campaigns.find(c => c.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign nahi mili' });
  c.status = 'cancelled';
  saveDB(db);
  res.json({ success: true });
});

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const db = getDB();
  const totalContacts = db.contacts.length;
  const totalCampaigns = db.campaigns.length;
  const totalSent = db.messages.filter(m => m.status === 'sent').length;
  const totalFailed = db.messages.filter(m => m.status === 'failed').length;
  const totalPending = db.messages.filter(m => m.status === 'pending').length;
  const activeCampaigns = db.campaigns.filter(c => c.status === 'running').length;
  const totalChats = (db.chats || []).length;
  const unreadChats = (db.chats || []).filter(m => m.direction === 'in' && !m.read).length;
  res.json({ totalContacts, totalCampaigns, totalSent, totalFailed, totalPending, activeCampaigns, totalChats, unreadChats });
});

// ─── META WA TEMPLATE MANAGER ─────────────────────────────────────────────────

// GET all templates from Meta (live status)
app.get('/api/meta-templates', auth, async (req, res) => {
  const db = getDB();
  const { phoneNumberId, accessToken, apiVersion, wabaId } = db.settings;
  if (!accessToken || !wabaId) return res.status(400).json({ error: 'Settings mein Access Token te WABA ID set karo pehle' });
  try {
    const r = await axios.get(
      `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 100, fields: 'name,status,category,language,components,rejected_reason,quality_score' },
        timeout: 12000
      }
    );
    res.json({ templates: r.data.data || [], paging: r.data.paging });
  } catch (e) {
    res.status(400).json({ error: e.response?.data?.error?.message || 'Meta API error: ' + e.message });
  }
});

// GET single template status from Meta
app.get('/api/meta-templates/:name', auth, async (req, res) => {
  const db = getDB();
  const { accessToken, apiVersion, wabaId } = db.settings;
  if (!accessToken || !wabaId) return res.status(400).json({ error: 'Settings mein Access Token te WABA ID set karo pehle' });
  try {
    const r = await axios.get(
      `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { name: req.params.name, fields: 'name,status,category,language,components,rejected_reason,quality_score' },
        timeout: 10000
      }
    );
    const found = r.data.data?.[0];
    if (!found) return res.status(404).json({ error: 'Template nahi mili Meta te' });
    res.json(found);
  } catch (e) {
    res.status(400).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// POST submit new template to Meta for approval
app.post('/api/meta-templates', auth, async (req, res) => {
  const db = getDB();
  const { accessToken, apiVersion, wabaId } = db.settings;
  if (!accessToken || !wabaId) return res.status(400).json({ error: 'Settings mein Access Token te WABA ID set karo pehle' });

  const { name, category, language, header, body: bodyText, footer, buttons } = req.body;
  if (!name || !category || !bodyText) return res.status(400).json({ error: 'name, category te body zaroori hain' });

  // Build components array
  const components = [];
  if (header) {
    if (header.type === 'text') {
      components.push({ type: 'HEADER', format: 'TEXT', text: header.text });
    } else if (['IMAGE','VIDEO','DOCUMENT'].includes(header.type)) {
      components.push({ type: 'HEADER', format: header.type });
    }
  }
  const bodyVars = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(() => 'example');
  const bodyComp = { type: 'BODY', text: bodyText };
  if (bodyVars.length > 0) bodyComp.example = { body_text: [bodyVars] };
  components.push(bodyComp);
  if (footer) components.push({ type: 'FOOTER', text: footer });
  if (buttons && buttons.length > 0) {
    components.push({ type: 'BUTTONS', buttons });
  }

  try {
    const r = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`,
      { name, category: category.toUpperCase(), language: language || 'en', components },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 12000 }
    );
    res.json({ success: true, id: r.data.id, status: r.data.status });
  } catch (e) {
    res.status(400).json({ error: e.response?.data?.error?.message || e.message, details: e.response?.data?.error });
  }
});

// DELETE template from Meta
app.delete('/api/meta-templates/:name', auth, async (req, res) => {
  const db = getDB();
  const { accessToken, apiVersion, wabaId } = db.settings;
  if (!accessToken || !wabaId) return res.status(400).json({ error: 'Settings mein Access Token te WABA ID set karo pehle' });
  try {
    await axios.delete(
      `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { name: req.params.name },
        timeout: 10000
      }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
const frontendBuild = path.resolve(__dirname, '../frontend/build');
const frontendDirect = path.resolve(__dirname, '../frontend');
const frontendIndex = fs.existsSync(frontendBuild)
  ? path.resolve(frontendBuild, 'index.html')
  : path.resolve(frontendDirect, 'index.html');
const frontendStatic = fs.existsSync(frontendBuild) ? frontendBuild : frontendDirect;

console.log('📁 Frontend dir:', frontendStatic);
console.log('📄 Index.html:', frontendIndex);
console.log('✅ Dir exists:', fs.existsSync(frontendStatic));
console.log('✅ Index exists:', fs.existsSync(frontendIndex));

app.use((req, res, next) => { console.log('PRE-STATIC:', req.method, req.url); next(); });
app.use(express.static(frontendStatic));
app.use((req, res, next) => {
  console.log('POST-STATIC (not served by static):', req.method, req.url);
  if (req.path.startsWith('/api/')) return next();
  res.sendFile('index.html', { root: frontendStatic }, (err) => {
    if (err) { console.error('sendFile err:', err.message); next(err); }
  });
});

app.listen(PORT, () => console.log(`✅ WA Bulk Server chal raha hai port ${PORT} te`));
