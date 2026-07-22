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

/**
 * 現在はインメモリで会話状態を保持します。
 * Renderが再起動すると状態はリセットされます。
 */
const userStates = new Map();

function getState(userId) {
  return userStates.get(userId) || { flow: "NONE" };
}

function setState(userId, flow) {
  if (userId) {
    userStates.set(userId, { flow });
  }
}

function resetState(userId) {
  if (userId) {
    userStates.set(userId, { flow: "NONE" });
  }
}

app.get("/", (_req, res) => {
  res.status(200).send("CareLink LINE BOT is running");
});

function validateLineSignature(req) {
  if (!CHANNEL_SECRET) {
    return false;
  }

  const signature = req.headers["x-line-signature"];

  if (!signature) {
    return false;
  }

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
    "💬詳しく相談する": "スタッフに相談",
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
  if (!ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is missing");
  }

  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages,
    },
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

  if (items.length > 0) {
    message.quickReply = {
      items,
    };
  }

  await replyMessages(replyToken, [message]);
}

/**
 * LINE上に「・・・」の入力中表示を出します。
 */
async function showLoading(userId, loadingSeconds = 5) {
  if (!ACCESS_TOKEN || !userId) {
    return;
  }

  try {
    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        chatId: userId,
        loadingSeconds,
      },
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getLineProfile(userId) {
  if (!ACCESS_TOKEN || !userId) {
    return null;
  }

  try {
    const response = await axios.get(
      `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        timeout: 8000,
      }
    );

    return response.data || null;
  } catch (error) {
    console.warn(
      "LINE profile error:",
      error?.response?.data || error?.message
    );

    return null;
  }
}

async function saveLog(userId, message, flow) {
  if (!supabase) {
    return;
  }

  try {
    const { error } = await supabase.from("line_logs").insert([
      {
        user_id: userId || "",
        message: String(message || ""),
        flow: flow || "NONE",
      },
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
    }
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

async function notifySlack({
  userId,
  displayName,
  message,
  flow,
}) {
  if (!SLACK_WEBHOOK_URL) {
    return;
  }

  const text = [
    "【CareLink LINE問い合わせ通知】",
    `相談日時：${formatJapanDate()}`,
    `ユーザー名：${displayName || "取得できませんでした"}`,
    `LINE userId：${userId || "不明"}`,
    `相談経路：${flow || "不明"}`,
    `相談内容：${message || ""}`,
  ].join("\n");

  try {
    await axios.post(
      SLACK_WEBHOOK_URL,
      {
        text,
      },
      {
        timeout: 10000,
      }
    );
  } catch (error) {
    console.error(
      "Slack notification error:",
      error?.response?.data || error?.message
    );
  }
}

function topMenuOptions() {
  return [
    {
      label: "📢掲載について",
      text: "掲載について",
    },
    {
      label: "💰料金について",
      text: "料金について",
    },
    {
      label: "📝登録方法",
      text: "登録方法",
    },
    {
      label: "✨使える機能",
      text: "使える機能",
    },
  ];
}

function greetingMenuOptions() {
  return [
    {
      label: "📢掲載について",
      text: "掲載について",
    },
    {
      label: "💰料金について",
      text: "料金について",
    },
    {
      label: "📝登録方法",
      text: "登録方法",
    },
    {
      label: "👨‍💼スタッフに相談",
      text: "スタッフに相談",
    },
  ];
}

function commonOptions() {
  return [
    {
      label: "🔗掲載ページを見る",
      uri: CARELINK_SALON_URL,
    },
    {
      label: "👨‍💼スタッフに相談",
      text: "スタッフに相談",
    },
    {
      label: "🏠メニュー",
      text: "メニュー",
    },
  ];
}

function listingAnswerOptions() {
  return [
    {
      label: "📝登録方法",
      text: "登録方法",
    },
    {
      label: "✨使える機能",
      text: "使える機能",
    },
    {
      label: "👨‍💼スタッフに相談",
      text: "スタッフに相談",
    },
    {
      label: "🏠メニュー",
      text: "メニュー",
    },
  ];
}

function priceOptions() {
  return [
    {
      label: "📝登録方法",
      text: "登録方法",
    },
    {
      label: "✨使える機能",
      text: "使える機能",
    },
    {
      label: "👨‍💼スタッフに相談",
      text: "スタッフに相談",
    },
    {
      label: "🏠メニュー",
      text: "メニュー",
    },
  ];
}

async function replyTopMenu(replyToken, greeting = false) {
  if (greeting) {
    await replyText(
      replyToken,
      `友だち追加ありがとうございます😊
CareLinkお問い合わせ窓口です。

施設掲載や料金、登録方法についてご案内します。
気になる内容を下から選んでください。

当てはまる項目がない場合は、スタッフへ直接ご相談いただけます。`,
      greetingMenuOptions()
    );

    return;
  }

  await replyText(
    replyToken,
    `メニューに戻りました。

続けて確認したい内容を、下から選んでください。`,
    topMenuOptions()
  );
}

async function replyListingStep(replyToken) {
  await replyText(
    replyToken,
    `掲載をご検討いただきありがとうございます。

ご案内内容を合わせるため、施設・事業所に近いものを選んでください。`,
    [
      {
        label: "💇美容サロン系",
        text: "美容サロン系",
      },
      {
        label: "🏥医療・治療院系",
        text: "医療・治療院系",
      },
      {
        label: "🧓介護・福祉系",
        text: "介護・福祉系",
      },
      {
        label: "❓その他の業種",
        text: "その他の業種",
      },
    ]
  );
}

async function replyListingAnswer(replyToken, category) {
  let text;

  if (category === "美容サロン系") {
    text = `以下のような美容関連施設を掲載できます。

・美容サロン
・アイラッシュサロン
・ネイルサロン
・リラクゼーション
・エステサロン
・美容クリニック

掲載料・初期費用・予約手数料は無料です。

上記以外の業種も、お気軽にご相談ください。`;
  } else if (category === "医療・治療院系") {
    text = `以下のような医療・治療院関連施設を掲載できます。

・鍼灸院
・整骨院、接骨院
・整体院
・歯科クリニック

掲載料・初期費用・予約手数料は無料です。

対象になるか分からない場合も、お気軽にご相談ください。`;
  } else if (category === "介護・福祉系") {
    text = `介護・福祉関連の施設も掲載対象です。

たとえば、以下のような施設をご相談いただけます。

・介護施設
・デイサービス
・福祉関連事業所

施設内容によってご案内が異なるため、詳しくはスタッフが確認します。`;
  } else {
    text = `掲載対象として案内されていない業種も、ご相談いただけます。

施設名や事業内容をお送りいただければ、スタッフが確認します。`;
  }

  await replyText(
    replyToken,
    text,
    listingAnswerOptions()
  );
}

async function replyPrice(replyToken) {
  await replyText(
    replyToken,
    `費用面、気になりますよね。

CareLinkでは、以下の費用はかかりません。

・掲載料
・初期費用
・予約手数料
・解約金

最低契約期間はなく、クレジットカード登録も不要です。`,
    priceOptions()
  );
}

async function replyRegistration(replyToken) {
  await replyText(
    replyToken,
    `登録は難しくありません。

掲載開始までの流れはこちらです。

1. 施設名・業種・連絡先を入力
2. メールアドレスでアカウントを作成
3. 管理画面でメニューや写真を登録
4. 公開ボタンから掲載開始

登録は約3分で、最短当日から掲載を開始できます。

途中で迷った場合は、スタッフへご相談ください。`,
    commonOptions()
  );
}

async function replyFeaturesStep(replyToken) {
  await replyText(
    replyToken,
    `CareLinkでは、予約受付から顧客管理まで、施設運営に使える機能を利用できます。

気になる機能を選んでください。`,
    [
      {
        label: "📅予約・通知",
        text: "予約・通知",
      },
      {
        label: "📣集客・口コミ",
        text: "集客・口コミ",
      },
      {
        label: "👥顧客・スタッフ管理",
        text: "顧客・スタッフ管理",
      },
      {
        label: "📊売上・分析",
        text: "売上・分析",
      },
    ]
  );
}

async function replyFeatureAnswer(replyToken, feature) {
  let text;

  if (feature === "予約・通知") {
    text = `予約受付や通知に関する主な機能はこちらです。

・24時間オンライン予約
・空き枠の自動計算
・予約確認通知
・リマインド通知
・キャンセル通知
・新規予約のリアルタイム通知

予約対応の手間を減らしながら、受付漏れも防げます。`;
  } else if (feature === "集客・口コミ") {
    text = `集客や情報発信に使える主な機能はこちらです。

・メニュー、料金の掲載
・施設写真の掲載
・口コミ、評価
・クーポン管理

新規のお客様への案内や、再来店のきっかけづくりに活用できます。`;
  } else if (feature === "顧客・スタッフ管理") {
    text = `顧客やスタッフに関する主な機能はこちらです。

・顧客情報の管理
・スタッフごとの指名予約
・指名料の設定
・スタッフのポートフォリオ掲載

顧客対応とスタッフ管理を、まとめて行えます。`;
  } else {
    text = `売上や利用状況を確認できる主な機能はこちらです。

・日別売上チャート
・リピート率
・顧客セグメント
・予約状況の確認

日々の運営状況を把握し、改善に活用できます。`;
  }

  await replyText(
    replyToken,
    text,
    commonOptions()
  );
}

async function startHandoff(replyToken, userId) {
  setState(userId, "HANDOFF_WAIT");

  await replyText(
    replyToken,
    `承知しました。
担当スタッフへおつなぎします。

確認したいことやお困りの内容を、1メッセージで送ってください。

内容を確認後、順次対応いたします。`,
    [
      {
        label: "🏠メニュー",
        text: "メニュー",
      },
    ]
  );
}

async function completeHandoff(replyToken) {
  await replyText(
    replyToken,
    `ご相談内容をお送りいただき、ありがとうございます。

受付が完了しました。
担当スタッフが確認のうえ、順次ご連絡いたします。`,
    [
      {
        label: "🏠メニュー",
        text: "メニュー",
      },
    ]
  );
}

const CLAUDE_SYSTEM_PROMPT = [
  "あなたはCareLinkのLINEお問い合わせ受付です。",
  "CareLinkは美容・医療・福祉施設の検索・予約サービスです。",
  "ユーザーの自由入力を短く丁寧に受け止めてください。",
  "毎回同じ言い回しを使わず、質問内容に合わせて自然な導入文にしてください。",
  "掲載料・初期費用・予約手数料は無料です。",
  "不明な料金、契約条件、対応可否を推測して回答してはいけません。",
  "長い項目の列挙が必要な場合は、読みやすい箇条書きを使用してください。",
  "質問は最大1つにしてください。",
  "必ず既存メニューへ誘導してください。",
  "出力はJSONのみです。",
  '{"text":"短く自然な返信","options":["掲載について","料金について","登録方法","スタッフに相談"]}',
].join("\n");

function parseClaudeJson(raw) {
  try {
    const value = String(raw || "").trim();
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");

    if (start < 0 || end < start) {
      return null;
    }

    return JSON.parse(
      value.slice(start, end + 1)
    );
  } catch {
    return null;
  }
}

function normalizeClaudeOptions(options) {
  const allowed = new Set([
    "掲載について",
    "料金について",
    "登録方法",
    "使える機能",
    "スタッフに相談",
    "メニュー",
  ]);

  if (!Array.isArray(options)) {
    return topMenuOptions();
  }

  return options
    .map((option) => canonicalizeInput(option))
    .filter((option) => allowed.has(option))
    .slice(0, 4)
    .map((option) => ({
      label: option,
      text: option,
    }));
}

async function claudeFallback(
  replyToken,
  userId,
  input
) {
  if (!CLAUDE_API_KEY) {
    await replyText(
      replyToken,
      `お問い合わせありがとうございます。

内容に近い項目を、下から選んでください。
当てはまるものがない場合は、スタッフへご相談いただけます。`,
      [
        {
          label: "掲載について",
          text: "掲載について",
        },
        {
          label: "料金について",
          text: "料金について",
        },
        {
          label: "登録方法",
          text: "登録方法",
        },
        {
          label: "スタッフに相談",
          text: "スタッフに相談",
        },
      ]
    );

    return;
  }

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: CLAUDE_MODEL,
        max_tokens: 450,
        system: CLAUDE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: input,
          },
        ],
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

    const options = normalizeClaudeOptions(
      parsed?.options
    );

    await replyText(
      replyToken,
      parsed?.text ||
        `お問い合わせありがとうございます。

内容に近い項目を、下から選んでください。
当てはまるものがない場合は、スタッフへご相談いただけます。`,
      options.length > 0
        ? options
        : topMenuOptions()
    );
  } catch (error) {
    console.error(
      "Claude API error:",
      error?.response?.data || error?.message
    );

    await replyText(
      replyToken,
      `申し訳ありません。
現在、内容をうまく確認できませんでした。

近い項目を選ぶか、スタッフへご相談ください。`,
      [
        {
          label: "📢掲載について",
          text: "掲載について",
        },
        {
          label: "💰料金について",
          text: "料金について",
        },
        {
          label: "📝登録方法",
          text: "登録方法",
        },
        {
          label: "👨‍💼スタッフに相談",
          text: "スタッフに相談",
        },
      ]
    );
  }
}

function isListingCategory(input) {
  return [
    "美容サロン系",
    "医療・治療院系",
    "介護・福祉系",
    "その他の業種",
  ].includes(input);
}

function isFeatureCategory(input) {
  return [
    "予約・通知",
    "集客・口コミ",
    "顧客・スタッフ管理",
    "売上・分析",
  ].includes(input);
}

app.post("/webhook", async (req, res) => {
  if (!validateLineSignature(req)) {
    return res
      .status(401)
      .send("Invalid signature");
  }

  /**
   * LINEへは先に200を返し、
   * 後続処理を継続します。
   */
  res.status(200).send("OK");

  const events = Array.isArray(req.body?.events)
    ? req.body.events
    : [];

  for (const event of events) {
    try {
      const userId =
        event.source?.userId || "";

      const replyToken =
        event.replyToken;

      /**
       * 友だち追加時
       */
      if (event.type === "follow") {
        resetState(userId);

        await showLoading(userId, 5);
        await sleep(800);

        await replyTopMenu(
          replyToken,
          true
        );

        continue;
      }

      /**
       * テキスト以外は処理しません。
       */
      if (
        event.type !== "message" ||
        event.message?.type !== "text"
      ) {
        continue;
      }

      const input = canonicalizeInput(
        event.message.text
      );

      const state = getState(userId);

      await saveLog(
        userId,
        input,
        state.flow
      );

      /**
       * 固定返信前の入力中表示
       */
      await showLoading(userId, 5);
      await sleep(800);

      /**
       * メニュー復帰
       */
      if (input === "メニュー") {
        resetState(userId);

        await replyTopMenu(
          replyToken,
          false
        );

        continue;
      }

      /**
       * スタッフ相談内容の受信
       */
      if (state.flow === "HANDOFF_WAIT") {
        const profile =
          await getLineProfile(userId);

        await notifySlack({
          userId,
          displayName:
            profile?.displayName,
          message: input,
          flow: state.flow,
        });

        await saveLog(
          userId,
          input,
          "HANDOFF_COMPLETE"
        );

        resetState(userId);

        await completeHandoff(
          replyToken
        );

        continue;
      }

      /**
       * スタッフ相談開始
       */
      if (input === "スタッフに相談") {
        await startHandoff(
          replyToken,
          userId
        );

        continue;
      }

      /**
       * 掲載カテゴリ選択開始
       */
      if (input === "掲載について") {
        setState(
          userId,
          "LISTING_CATEGORY"
        );

        await replyListingStep(
          replyToken
        );

        continue;
      }

      /**
       * 掲載カテゴリ回答
       */
      if (
        state.flow === "LISTING_CATEGORY" &&
        isListingCategory(input)
      ) {
        resetState(userId);

        await replyListingAnswer(
          replyToken,
          input
        );

        continue;
      }

      /**
       * 掲載カテゴリ選択中に
       * 想定外の文字が来た場合
       */
      if (
        state.flow === "LISTING_CATEGORY"
      ) {
        resetState(userId);

        await claudeFallback(
          replyToken,
          userId,
          input
        );

        continue;
      }

      /**
       * 料金
       */
      if (input === "料金について") {
        resetState(userId);

        await replyPrice(
          replyToken
        );

        continue;
      }

      /**
       * 登録方法
       */
      if (input === "登録方法") {
        resetState(userId);

        await replyRegistration(
          replyToken
        );

        continue;
      }

      /**
       * 機能カテゴリ選択開始
       */
      if (input === "使える機能") {
        setState(
          userId,
          "FEATURE_CATEGORY"
        );

        await replyFeaturesStep(
          replyToken
        );

        continue;
      }

      /**
       * 機能カテゴリ回答
       */
      if (
        state.flow === "FEATURE_CATEGORY" &&
        isFeatureCategory(input)
      ) {
        resetState(userId);

        await replyFeatureAnswer(
          replyToken,
          input
        );

        continue;
      }

      /**
       * 機能カテゴリ選択中に
       * 想定外の文字が来た場合
       */
      if (
        state.flow === "FEATURE_CATEGORY"
      ) {
        resetState(userId);

        await claudeFallback(
          replyToken,
          userId,
          input
        );

        continue;
      }

      /**
       * それ以外の自由入力はClaudeへ送ります。
       */
      await claudeFallback(
        replyToken,
        userId,
        input
      );
    } catch (error) {
      console.error(
        "Webhook event error:",
        error?.response?.data || error?.message
      );
    }
  }
});

const PORT = Number(
  process.env.PORT || 3000
);

app.listen(PORT, () => {
  console.log(
    `CareLink LINE BOT running on port ${PORT}`
  );

  console.log(
    "Claude configured:",
    Boolean(CLAUDE_API_KEY)
  );

  console.log(
    "Supabase configured:",
    Boolean(supabase)
  );

  console.log(
    "Slack configured:",
    Boolean(SLACK_WEBHOOK_URL)
  );
});
