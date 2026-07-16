import express from "express";
import axios from "axios";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || "";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const CARELINK_SALON_URL =
  process.env.CARELINK_SALON_URL || "https://carelink-jp.com/salon";

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

const userStates = new Map();

function getState(userId) {
  return userStates.get(userId) || { flow: "NONE" };
}

function setState(userId, flow) {
  if (userId) userStates.set(userId, { flow });
}

function resetState(userId) {
  if (userId) userStates.set(userId, { flow: "NONE" });
}

app.get("/", (_req, res) => {
  res.status(200).send("CareLink LINE BOT is running");
});

function validateLineSignature(req) {
  if (!CHANNEL_SECRET) return false;
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.rawBody || Buffer.from(""))
    .digest("base64");

  const expected = Buffer.from(hash);
  const actual = Buffer.from(String(signature));
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}

function canonicalizeInput(text) {
  const raw = String(text || "").trim();
  const map = {
    "📢掲載について": "掲載について",
    "💰料金について": "料金について",
    "📝登録方法": "登録方法",
    "✨使える機能": "使える機能",
    "👨‍💼スタッフに相談": "スタッフに相談",
    "👨‍💼スタッフ対応": "スタッフに相談",
    "🏠メニュー": "メニュー",
    "💇美容サロン系": "美容サロン系",
    "🏥医療・治療院系": "医療・治療院系",
    "🧓介護・福祉系": "介護・福祉系",
    "❓その他の業種": "その他の業種",
    "📅予約・通知": "予約・通知",
    "📣集客・口コミ": "集客・口コミ",
    "👥顧客・スタッフ管理": "顧客・スタッフ管理",
    "📊売上・分析": "売上・分析",
    "🔗掲載ページを見る": "掲載ページを見る",
    "💬詳しく相談する": "スタッフに相談",
  };
  return map[raw] || raw;
}

function quickReplyItems(options = []) {
  return options.slice(0, 4).map((option) => ({
    type: "action",
    action: option.uri
      ? {
          type: "uri",
          label: option.label.slice(0, 20),
          uri: option.uri,
        }
      : {
          type: "message",
          label: option.label.slice(0, 20),
          text: option.text || canonicalizeInput(option.label),
        },
  }));
}

async function replyMessages(replyToken, messages) {
  if (!ACCESS_TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is missing");

  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      timeout: 10000,
    }
  );
}

async function replyText(replyToken, text, options = []) {
  const message = {
    type: "text",
    text: String(text).slice(0, 5000),
  };

  const items = quickReplyItems(options);
  if (items.length) message.quickReply = { items };

  await replyMessages(replyToken, [message]);
}

async function showLoading(userId, loadingSeconds = 10) {
  if (!ACCESS_TOKEN || !userId) return;
  try {
    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      { chatId: userId, loadingSeconds },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        timeout: 5000,
      }
    );
  } catch (error) {
    console.warn(
      "Loading animation error:",
      error?.response?.data || error?.message
    );
  }
}

async function getLineProfile(userId) {
  if (!ACCESS_TOKEN || !userId) return null;
  try {
    const response = await axios.get(
      `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        timeout: 8000,
      }
    );
    return response.data || null;
  } catch (error) {
    console.warn("LINE profile error:", error?.response?.data || error?.message);
    return null;
  }
}

async function saveLog(userId, message, flow) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("line_logs").insert([
      {
        user_id: userId || "",
        message: String(message || ""),
        flow: flow || "NONE",
      },
    ]);
    if (error) console.error("Supabase insert error:", error);
  } catch (error) {
    console.error("Supabase log error:", error?.message || error);
  }
}

function formatJapanDate(date = new Date()) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

async function notifySlack({ userId, displayName, message, flow }) {
  if (!SLACK_WEBHOOK_URL) return;

  const text = [
    "【CareLink LINE問い合わせ通知】",
    `相談日時：${formatJapanDate()}`,
    `ユーザー名：${displayName || "取得できませんでした"}`,
    `LINE userId：${userId || "不明"}`,
    `相談経路：${flow || "不明"}`,
    `相談内容：${message || ""}`,
  ].join("\n");

  try {
    await axios.post(SLACK_WEBHOOK_URL, { text }, { timeout: 10000 });
  } catch (error) {
    console.error("Slack notification error:", error?.response?.data || error?.message);
  }
}

function topMenuOptions() {
  return [
    { label: "📢掲載について", text: "掲載について" },
    { label: "💰料金について", text: "料金について" },
    { label: "📝登録方法", text: "登録方法" },
    { label: "✨使える機能", text: "使える機能" },
  ];
}

function commonOptions() {
  return [
    { label: "🔗掲載ページを見る", uri: CARELINK_SALON_URL },
    { label: "👨‍💼スタッフに相談", text: "スタッフに相談" },
    { label: "🏠メニュー", text: "メニュー" },
  ];
}

async function replyTopMenu(replyToken, greeting = false) {
  const text = greeting
    ? "ご登録ありがとうございます。CareLinkです。\n\nCareLinkは、美容・医療・福祉施設を検索・予約できるサービスです。施設掲載について知りたい内容を選んでください。"
    : "メニューに戻りました。\n\n知りたい内容を選んでください。";
  await replyText(replyToken, text, topMenuOptions());
}

async function replyListingStep(replyToken) {
  await replyText(
    replyToken,
    "掲載をご検討いただきありがとうございます。\n\nどのような施設・事業所に近いですか？",
    [
      { label: "💇美容サロン系", text: "美容サロン系" },
      { label: "🏥医療・治療院系", text: "医療・治療院系" },
      { label: "🧓介護・福祉系", text: "介護・福祉系" },
      { label: "❓その他の業種", text: "その他の業種" },
    ]
  );
}

async function replyListingAnswer(replyToken, category) {
  let text;

  if (category === "美容サロン系") {
    text =
      "CareLinkでは、美容サロン、アイラッシュ、ネイル、リラク、エステ、美容クリニックなどを掲載できます。\n\n掲載料・初期費用・予約手数料は無料です。";
  } else if (category === "医療・治療院系") {
    text =
      "CareLinkでは、鍼灸院、整骨院・接骨院、整体院、歯科クリニックなどを掲載できます。\n\n掲載料・初期費用・予約手数料は無料です。";
  } else if (category === "介護・福祉系") {
    text =
      "CareLinkでは、介護施設やデイサービスなども掲載対象です。\n\n詳細な掲載条件は、施設内容を確認したうえでご案内します。";
  } else {
    text =
      "掲載対象として案内されていない業種も相談できます。\n\n施設・事業内容をスタッフへお知らせください。";
  }

  await replyText(replyToken, text, [
    { label: "📝登録方法", text: "登録方法" },
    { label: "✨使える機能", text: "使える機能" },
    { label: "👨‍💼スタッフに相談", text: "スタッフに相談" },
    { label: "🏠メニュー", text: "メニュー" },
  ]);
}

async function replyPrice(replyToken) {
  await replyText(
    replyToken,
    "CareLinkは、掲載料・初期費用・予約手数料が無料です。\n\n最低契約期間や解約金もなく、クレジットカード登録も不要です。",
    [
      { label: "📝登録方法", text: "登録方法" },
      { label: "✨使える機能", text: "使える機能" },
      { label: "👨‍💼スタッフに相談", text: "スタッフに相談" },
      { label: "🏠メニュー", text: "メニュー" },
    ]
  );
}

async function replyRegistration(replyToken) {
  await replyText(
    replyToken,
    "掲載開始までの流れはこちらです。\n\n1. 施設名・業種・連絡先を入力\n2. メールアドレスでアカウント作成\n3. 管理画面でメニューや写真を登録\n4. 公開ボタンから掲載開始\n\n登録は約3分、最短当日から掲載を開始できます。",
    commonOptions()
  );
}

async function replyFeaturesStep(replyToken) {
  await replyText(
    replyToken,
    "CareLinkでは、掲載・予約・顧客管理などの機能を無料で利用できます。\n\n知りたい機能を選んでください。",
    [
      { label: "📅予約・通知", text: "予約・通知" },
      { label: "📣集客・口コミ", text: "集客・口コミ" },
      { label: "👥顧客・スタッフ管理", text: "顧客・スタッフ管理" },
      { label: "📊売上・分析", text: "売上・分析" },
    ]
  );
}

async function replyFeatureAnswer(replyToken, feature) {
  let text;

  if (feature === "予約・通知") {
    text =
      "24時間のオンライン予約受付に対応しています。\n\n空き枠の自動計算、予約確認・リマインド・キャンセルのLINE通知、新規予約のリアルタイム通知も利用できます。";
  } else if (feature === "集客・口コミ") {
    text =
      "メニュー・料金・写真の掲載、口コミ・評価、クーポン管理を利用できます。\n\nお客様への情報発信や再来店のきっかけづくりに活用できます。";
  } else if (feature === "顧客・スタッフ管理") {
    text =
      "顧客管理に加えて、スタッフごとの指名予約・指名料設定・ポートフォリオ掲載に対応しています。";
  } else {
    text =
      "日別売上チャート、リピート率、顧客セグメントなどの分析機能を利用できます。";
  }

  await replyText(replyToken, text, commonOptions());
}

async function startHandoff(replyToken, userId) {
  setState(userId, "HANDOFF_WAIT");
  await replyText(
    replyToken,
    "担当者へおつなぎするため、ご相談内容を1メッセージで送ってください。\n確認後、順次対応いたします。",
    [{ label: "🏠メニュー", text: "メニュー" }]
  );
}

async function completeHandoff(replyToken) {
  await replyText(
    replyToken,
    "ありがとうございます。\nご相談内容を受け付けました。\n担当者が確認のうえ、順次対応いたします。",
    [{ label: "🏠メニュー", text: "メニュー" }]
  );
}

const CLAUDE_SYSTEM_PROMPT = [
  "あなたはCareLinkのLINEお問い合わせ受付です。",
  "ユーザーの自由入力を短く受け止め、必ず既存メニューへ戻してください。",
  "CareLinkは美容・医療・福祉施設の検索・予約サービスです。",
  "掲載料・初期費用・予約手数料は無料です。",
  "不明な料金、契約条件、対応可否を推測して回答してはいけません。",
  "質問は最大1つ、文章は短く丁寧にしてください。",
  "出力はJSONのみです。",
  '{"text":"短い返信","options":["掲載について","料金について","登録方法","スタッフに相談"]}',
].join("\n");

function parseClaudeJson(raw) {
  try {
    const value = String(raw || "").trim();
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function claudeFallback(replyToken, userId, input) {
  if (!CLAUDE_API_KEY) {
    await replyText(
      replyToken,
      "内容を確認しました。近い項目を選んでください。",
      topMenuOptions()
    );
    return;
  }

  await showLoading(userId, 10);

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: CLAUDE_MODEL,
        max_tokens: 350,
        system: CLAUDE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: input }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        timeout: 20000,
      }
    );

    const raw = response.data?.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    const parsed = parseClaudeJson(raw);
    const allowed = new Set([
      "掲載について",
      "料金について",
      "登録方法",
      "使える機能",
      "スタッフに相談",
      "メニュー",
    ]);

    const options = Array.isArray(parsed?.options)
      ? parsed.options
          .map((option) => canonicalizeInput(option))
          .filter((option) => allowed.has(option))
          .slice(0, 4)
          .map((option) => ({ label: option, text: option }))
      : topMenuOptions();

    await replyText(
      replyToken,
      parsed?.text || "内容を確認しました。近い項目を選んでください。",
      options.length ? options : topMenuOptions()
    );
  } catch (error) {
    console.error("Claude API error:", error?.response?.data || error?.message);
    await replyText(
      replyToken,
      "うまく内容を確認できませんでした。近い項目を選ぶか、スタッフへご相談ください。",
      [
        ...topMenuOptions().slice(0, 3),
        { label: "👨‍💼スタッフに相談", text: "スタッフに相談" },
      ]
    );
  }
}

app.post("/webhook", async (req, res) => {
  if (!validateLineSignature(req)) {
    return res.status(401).send("Invalid signature");
  }

  res.status(200).send("OK");

  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  for (const event of events) {
    try {
      const userId = event.source?.userId || "";
      const replyToken = event.replyToken;

      if (event.type === "follow") {
        resetState(userId);
        await replyTopMenu(replyToken, true);
        continue;
      }

      if (event.type !== "message" || event.message?.type !== "text") {
        continue;
      }

      const input = canonicalizeInput(event.message.text);
      const state = getState(userId);
      await saveLog(userId, input, state.flow);

      if (input === "メニュー") {
        resetState(userId);
        await replyTopMenu(replyToken);
        continue;
      }

      if (state.flow === "HANDOFF_WAIT") {
        const profile = await getLineProfile(userId);
        await notifySlack({
          userId,
          displayName: profile?.displayName,
          message: input,
          flow: state.flow,
        });
        await saveLog(userId, input, "HANDOFF_COMPLETE");
        resetState(userId);
        await completeHandoff(replyToken);
        continue;
      }

      if (input === "スタッフに相談") {
        await startHandoff(replyToken, userId);
        continue;
      }

      if (input === "掲載について") {
        setState(userId, "LISTING_CATEGORY");
        await replyListingStep(replyToken);
        continue;
      }

      if (state.flow === "LISTING_CATEGORY") {
        resetState(userId);
        await replyListingAnswer(replyToken, input);
        continue;
      }

      if (input === "料金について") {
        resetState(userId);
        await replyPrice(replyToken);
        continue;
      }

      if (input === "登録方法") {
        resetState(userId);
        await replyRegistration(replyToken);
        continue;
      }

      if (input === "使える機能") {
        setState(userId, "FEATURE_CATEGORY");
        await replyFeaturesStep(replyToken);
        continue;
      }

      if (state.flow === "FEATURE_CATEGORY") {
        resetState(userId);
        await replyFeatureAnswer(replyToken, input);
        continue;
      }

      await claudeFallback(replyToken, userId, input);
    } catch (error) {
      console.error("Webhook event error:", error?.response?.data || error?.message);
    }
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`CareLink LINE BOT running on port ${PORT}`);
  console.log("Claude configured:", Boolean(CLAUDE_API_KEY));
  console.log("Supabase configured:", Boolean(supabase));
  console.log("Slack configured:", Boolean(SLACK_WEBHOOK_URL));
});
