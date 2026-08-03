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
const CARELINK_REGISTER_URL =
  process.env.CARELINK_REGISTER_URL || "https://carelink-jp.com/register";

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

/**
 * 現在はインメモリで会話状態を保持します。
 * Renderが再起動すると状態はリセットされます。
 */
const userStates = new Map();

function createDefaultState() {
  return {
    flow: "NONE",
    questionCount: 0,
    history: [],
  };
}

function getState(userId) {
  return userStates.get(userId) || createDefaultState();
}

function updateState(userId, patch = {}) {
  if (!userId) return;

  const current = getState(userId);
  userStates.set(userId, {
    ...current,
    ...patch,
  });
}

function setFlow(userId, flow, resetQuestionCount = false) {
  updateState(userId, {
    flow,
    ...(resetQuestionCount ? { questionCount: 0 } : {}),
  });
}

function incrementQuestionCount(userId) {
  const current = getState(userId);
  updateState(userId, {
    questionCount: Number(current.questionCount || 0) + 1,
  });
}

function appendHistory(userId, role, content) {
  if (!userId || !content) return;

  const current = getState(userId);
  const history = Array.isArray(current.history) ? current.history : [];

  updateState(userId, {
    history: [
      ...history,
      {
        role,
        content: String(content).slice(0, 1200),
      },
    ].slice(-8),
  });
}

function resetState(userId) {
  if (!userId) return;
  userStates.set(userId, createDefaultState());
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
    "📄掲載について": "掲載について",
    "📢掲載について": "掲載について",
    "💰料金について": "料金について",
    "📝登録・使い方": "登録・使い方",
    "📝登録方法": "登録・使い方",
    "⚙️機能について": "機能について",
    "✨使える機能": "機能について",
    "💬その他の相談": "その他の相談",
    "🏠メニュー": "メニュー",

    "CareLinkカスタマーセンターに相談": "カスタマーセンターに相談",
    "カスタマーセンターへ相談": "カスタマーセンターに相談",
    "スタッフに相談": "カスタマーセンターに相談",
    "担当者に相談": "カスタマーセンターに相談",

    "自分の業種が掲載できるか": "業種が掲載対象か",
    "業種が掲載対象か": "業種が掲載対象か",
    "掲載までの流れ": "掲載までの流れ",
    "掲載すると何ができるか": "掲載すると何ができるか",
    "掲載でできること": "掲載すると何ができるか",
    "まだ具体的に決まっていない": "まだ具体的に決まっていない",
    "まだ決まっていない": "まだ具体的に決まっていない",

    "新しいお客様に知ってもらいたい": "新しいお客様に知ってもらいたい",
    "新しいお客様に知ってもらう": "新しいお客様に知ってもらいたい",
    "予約を受け付けたい": "予約を受け付けたい",
    "予約を受け付ける": "予約を受け付けたい",
    "口コミを活用したい": "口コミを活用したい",
    "口コミを活用する": "口コミを活用したい",
    "顧客やスタッフを管理したい": "顧客やスタッフを管理したい",
    "顧客・スタッフ管理": "顧客やスタッフを管理したい",
    "まずCareLink全体を知りたい": "CareLink全体を知りたい",
    "CareLink全体": "CareLink全体を知りたい",

    初期費用: "初期費用",
    月額料金: "月額料金",
    予約手数料: "予約手数料",
    "契約期間・解約": "契約期間・解約",
    "料金全体を知りたい": "料金全体",
    料金全体: "料金全体",
    "別の料金を確認する": "料金について",

    "これから登録したい": "これから登録したい",
    "これから登録": "これから登録したい",
    "登録方法を知りたい": "登録方法を知りたい",
    登録方法: "登録方法を知りたい",
    "登録後の使い方": "登録後の使い方",
    "掲載情報を変更したい": "掲載情報を変更したい",
    "掲載情報を変更": "掲載情報を変更したい",
    "掲載情報の管理": "掲載情報を変更したい",

    予約機能: "予約機能",
    "予約の管理": "予約機能",
    "口コミ・クーポン": "口コミ・クーポン",
    スタッフ管理: "スタッフ管理",
    "売上・顧客分析": "売上・顧客分析",
    "利用できる機能全体": "機能全体",
    機能全体: "機能全体",
    "別の機能を確認する": "機能について",

    "予約の受付方法": "予約の受付方法",
    "スタッフの指名予約": "スタッフの指名予約",
    "予約通知について": "予約通知について",
    "予約内容の確認・管理": "予約内容の確認・管理",
    "予約内容の管理": "予約内容の確認・管理",

    "口コミの確認・返信": "口コミの確認・返信",
    "クーポンの作成・管理": "クーポンの作成・管理",

    "スタッフ情報の登録": "スタッフ情報の登録",
    "指名予約・指名料": "指名予約・指名料",
    "操作権限について": "操作権限について",

    "売上の確認": "売上の確認",
    "顧客情報の管理": "顧客情報の管理",
    "リピート率・顧客分析": "リピート率・顧客分析",

    "無料掲載登録へ進む": "無料掲載登録へ進む",
    "登録に必要な情報": "登録に必要な情報",
    "利用できる機能": "機能について",

    解決した: "解決した",
    "もう少し確認": "もう少し確認したい",
    "もう少し確認したい": "もう少し確認したい",
    "別のことを確認": "メニュー",
    "別のことを確認したい": "メニュー",
  };

  return map[raw] || raw;
}

function quickReplyItems(options = []) {
  return options.slice(0, 5).map((option) => ({
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

  if (items.length > 0) {
    message.quickReply = { items };
  }

  await replyMessages(replyToken, [message]);
}

async function replyAndRemember(replyToken, userId, text, options = []) {
  await replyText(replyToken, text, options);
  appendHistory(userId, "assistant", text);
}

/**
 * LINE上に入力中表示を出します。
 */
async function showLoading(userId, loadingSeconds = 5) {
  if (!ACCESS_TOKEN || !userId) return;

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLineProfile(userId) {
  if (!ACCESS_TOKEN || !userId) return null;

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
  if (!supabase) return;

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
    console.error(
      "Slack notification error:",
      error?.response?.data || error?.message
    );
  }
}

function topMenuOptions() {
  return [
    { label: "📄掲載について", text: "掲載について" },
    { label: "💰料金について", text: "料金について" },
    { label: "📝登録・使い方", text: "登録・使い方" },
    { label: "⚙️機能について", text: "機能について" },
    { label: "💬その他の相談", text: "その他の相談" },
  ];
}

function solutionOptions() {
  return [
    { label: "解決した", text: "解決した" },
    { label: "もう少し確認", text: "もう少し確認したい" },
    { label: "別のことを確認", text: "メニュー" },
    {
      label: "カスタマーセンター",
      text: "カスタマーセンターに相談",
    },
  ];
}
async function replyTopMenu(replyToken, userId, greeting = false) {
  if (greeting) {
    const text = `CareLinkをご利用いただきありがとうございます😊

こちらでは、AIがご相談内容を確認しながら、必要な情報をご案内します。
内容に応じて、いくつか質問させていただく場合があります。

個別の確認が必要な場合は、CareLinkカスタマーセンターへおつなぎします。

掲載や料金、登録方法など、気になっていることをお気軽に教えてください。
下の選択肢のほか、入力欄から自由にご相談いただけます。`;

    await replyAndRemember(replyToken, userId, text, topMenuOptions());
    return;
  }

  const text = `メニューに戻りました😊

気になっている内容を選ぶか、入力欄から自由にご相談ください。`;

  await replyAndRemember(replyToken, userId, text, topMenuOptions());
}

async function replyListingMenu(replyToken, userId) {
  setFlow(userId, "LISTING_MENU", true);
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `掲載についてですね。
まず、どのようなことを確認したいですか？`,
    [
      { label: "業種が掲載対象か", text: "業種が掲載対象か" },
      { label: "掲載までの流れ", text: "掲載までの流れ" },
      { label: "掲載でできること", text: "掲載すると何ができるか" },
      { label: "料金について", text: "料金について" },
      { label: "まだ決まっていない", text: "まだ具体的に決まっていない" },
    ]
  );
}

async function askIndustry(replyToken, userId) {
  setFlow(userId, "LISTING_INDUSTRY_WAIT");
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `掲載できる業種について確認します。
どのような業種・サービスですか？`
  );
}

/**
 * CareLinkの新規登録画面で扱う業種をもとにした判定用キーワードです。
 * 登録画面の業種が変更された場合は、ここも更新してください。
 */
const SUPPORTED_INDUSTRY_GROUPS = [
  {
    name: "ヘアサロン",
    keywords: ["ヘアサロン", "美容室", "美容院", "理容室", "理容", "床屋"],
  },
  {
    name: "ネイル",
    keywords: ["ネイル", "ネイルサロン"],
  },
  {
    name: "まつげ",
    keywords: ["まつげ", "まつ毛", "マツエク", "アイラッシュ"],
  },
  {
    name: "リラク",
    keywords: ["リラク", "リラクゼーション", "もみほぐし"],
  },
  {
    name: "エステ",
    keywords: ["エステ", "エステサロン"],
  },
  {
    name: "美容クリニック",
    keywords: ["美容クリニック", "美容皮膚科", "美容医療"],
  },
  {
    name: "鍼灸院・整骨院",
    keywords: ["鍼灸", "鍼灸院", "はり", "お灸", "整骨院", "接骨院", "柔道整復"],
  },
  {
    name: "整体",
    keywords: ["整体", "整体院"],
  },
  {
    name: "ピラティス",
    keywords: ["ピラティス"],
  },
  　{
    name: "介護・福祉",
    keywords: [
      "介護",
      "福祉",
      "介護施設",
      "訪問介護",
      "デイサービス",
      "老人ホーム",
      "グループホーム",
      "福祉施設",
 　 ],
  },
  {
    name: "その他",
    keywords: [],
  },
];

function findSupportedIndustry(input) {
  const normalized = String(input || "")
    .toLowerCase()
    .replace(/\s+/g, "");

  return SUPPORTED_INDUSTRY_GROUPS.find((group) =>
    group.keywords.some((keyword) =>
      normalized.includes(String(keyword).toLowerCase().replace(/\s+/g, ""))
    )
  );
}

async function replyIndustryResult(replyToken, userId, input) {
  const matched = findSupportedIndustry(input);
  resetState(userId);

  if (matched) {
    await replyAndRemember(
      replyToken,
      userId,
      `ご相談ありがとうございます。
ご相談いただいた業種は、CareLinkの掲載対象に含まれています。
掲載までの流れについてもご案内できます。`,
      [
        { label: "掲載までの流れ", text: "掲載までの流れ" },
        { label: "料金について", text: "料金について" },
        { label: "利用できる機能", text: "機能について" },
        { label: "解決した", text: "解決した" },
      ]
    );
    return;
  }

  await replyAndRemember(
    replyToken,
    userId,
    `ご相談ありがとうございます。
申し訳ありませんが、現在CareLinkでは、ご相談いただいた業種は掲載対象に含まれていません。`,
    [
      { label: "別のことを確認", text: "メニュー" },
      {
        label: "カスタマーセンター",
        text: "カスタマーセンターに相談",
      },
    ]
  );
}

async function replyListingFlow(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `CareLinkへの掲載は、以下の流れで進められます。

① 施設情報を入力
② アカウントを作成
③ 管理画面からメニューや写真を登録
④ 登録内容を公開

最短3分で登録でき、最短当日から掲載を開始できます。

このまま無料掲載登録へ進みますか？`,
    [
      { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
      { label: "登録に必要な情報", text: "登録に必要な情報" },
      { label: "料金について", text: "料金について" },
      { label: "利用できる機能", text: "機能について" },
      { label: "解決した", text: "解決した" },
    ]
  );
}

async function replyRegistrationRequirements(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `無料掲載登録では、まず以下の情報を入力します。

・施設名
・業種
・代表者名
・担当者名
・メールアドレス
・電話番号

以下は任意で入力できます。

・担当者直通電話
・WebサイトURL

登録を進める場合は、無料掲載登録ページからお手続きください。`,
    [
      { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
      { label: "掲載までの流れ", text: "掲載までの流れ" },
      { label: "料金について", text: "料金について" },
      { label: "解決した", text: "解決した" },
    ]
  );
}

async function replyListingCapabilities(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `CareLinkでは、施設情報の掲載だけでなく、予約受付や口コミ管理などもまとめて行えます。

主な機能はこちらです。

・メニュー・料金の掲載
・24時間のオンライン予約受付
・口コミの確認・返信
・クーポンの発行・管理
・スタッフ情報・指名予約の管理
・売上・顧客データの分析
・施設・メニュー・スタッフ写真の管理
・新規予約のリアルタイム通知

特に詳しく知りたい内容はありますか？`,
    [
      { label: "予約機能", text: "予約機能" },
      { label: "口コミ・クーポン", text: "口コミ・クーポン" },
      { label: "スタッフ管理", text: "スタッフ管理" },
      { label: "売上・顧客分析", text: "売上・顧客分析" },
      { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
    ]
  );
}

async function replyUnclearGoal(replyToken, userId) {
  setFlow(userId, "GOAL_WAIT");
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `現在は情報を集めている段階なのですね。
CareLinkを利用して、特に実現したいことはありますか？`,
    [
      {
        label: "新しいお客様に知ってもらう",
        text: "新しいお客様に知ってもらいたい",
      },
      { label: "予約を受け付ける", text: "予約を受け付けたい" },
      { label: "口コミを活用する", text: "口コミを活用したい" },
      { label: "顧客・スタッフ管理", text: "顧客やスタッフを管理したい" },
      { label: "CareLink全体", text: "CareLink全体を知りたい" },
    ]
  );
}

async function replyPriceMenu(replyToken, userId) {
  setFlow(userId, "PRICE_MENU", true);
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `料金について、どの内容を確認したいですか？`,
    [
      { label: "初期費用", text: "初期費用" },
      { label: "月額料金", text: "月額料金" },
      { label: "予約手数料", text: "予約手数料" },
      { label: "契約期間・解約", text: "契約期間・解約" },
      { label: "料金全体", text: "料金全体" },
    ]
  );
}

async function replyPriceAnswer(replyToken, userId, input) {
  resetState(userId);

  const answers = {
    初期費用: `CareLinkの初期費用は0円です。
登録時にクレジットカードを用意する必要もありません。`,

    月額料金: `CareLinkの月額料金は0円です。
掲載料もかかりません。`,

    予約手数料: `CareLinkの予約手数料は0円です。
掲載料・初期費用・月額費用もかかりません。`,

    "契約期間・解約": `CareLinkには最低契約期間がなく、解約金も0円です。
必要に応じて、いつでも解約できます。`,

    料金全体: `CareLinkは、以下の費用がすべて0円です。

・初期費用
・月額費用
・掲載料
・予約手数料
・解約金

最低契約期間もなく、クレジットカードの登録も不要です。`,
  };

  await replyAndRemember(replyToken, userId, answers[input], [
    { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
    { label: "掲載までの流れ", text: "掲載までの流れ" },
    { label: "別の料金を確認", text: "料金について" },
    { label: "解決した", text: "解決した" },
  ]);
}

async function replyRegistrationMenu(replyToken, userId) {
  setFlow(userId, "REGISTRATION_MENU", true);
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `登録や使い方についてですね。
現在の状況に近いものを教えてください。`,
    [
      { label: "これから登録", text: "これから登録したい" },
      { label: "登録方法", text: "登録方法を知りたい" },
      { label: "登録後の使い方", text: "登録後の使い方" },
      { label: "掲載情報を変更", text: "掲載情報を変更したい" },
      { label: "その他", text: "その他の相談" },
    ]
  );
}

async function replyAfterRegistrationMenu(replyToken, userId) {
  setFlow(userId, "FEATURE_MENU", true);
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `登録後は、管理画面から掲載情報や予約などを管理できます。
どの内容を確認したいですか？`,
    [
      { label: "掲載情報の管理", text: "掲載情報を変更したい" },
      { label: "予約の管理", text: "予約機能" },
      { label: "口コミ・クーポン", text: "口コミ・クーポン" },
      { label: "スタッフ管理", text: "スタッフ管理" },
      { label: "売上・顧客分析", text: "売上・顧客分析" },
    ]
  );
}

async function replyListingEdit(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `掲載情報は、管理画面から変更できます。

施設情報・営業時間・メニュー・料金・写真・スタッフ情報などを確認し、必要な項目を編集してください。

ご案内した内容で確認できましたか？`,
    solutionOptions()
  );
}

async function replyFeatureMenu(replyToken, userId) {
  setFlow(userId, "FEATURE_MENU", true);
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `どの機能について確認したいですか？`,
    [
      { label: "予約機能", text: "予約機能" },
      { label: "口コミ・クーポン", text: "口コミ・クーポン" },
      { label: "スタッフ管理", text: "スタッフ管理" },
      { label: "売上・顧客分析", text: "売上・顧客分析" },
      { label: "機能全体", text: "機能全体" },
    ]
  );
}

async function replyReservationFeature(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `CareLinkでは、24時間オンラインで予約を受け付けられます。

主な予約機能はこちらです。

・空き時間の確認
・オンライン予約の受付
・スタッフの指名予約
・指名料の設定
・新規予約のリアルタイム通知
・予約内容の確認・管理

なお、現在は外部の予約サービスとの連携には対応していません。

どの内容を詳しく確認しますか？`,
    [
      { label: "予約の受付方法", text: "予約の受付方法" },
      { label: "スタッフの指名予約", text: "スタッフの指名予約" },
      { label: "予約通知について", text: "予約通知について" },
      { label: "予約内容の管理", text: "予約内容の確認・管理" },
      { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
    ]
  );
}
async function replyReservationDetail(replyToken, userId, input) {
  resetState(userId);

  const answers = {
    "予約の受付方法": `CareLinkでは、施設ページから24時間オンラインで予約を受け付けられます。
空き時間を確認しながら予約でき、受付内容は管理画面で確認できます。`,

    "スタッフの指名予約": `お客様が予約時にスタッフを指名できるよう設定できます。
スタッフごとの指名料も設定可能です。`,

    "予約通知について": `新しい予約が入った際は、リアルタイムで通知を受け取れます。
予約内容は管理画面から確認できます。`,

    "予約内容の確認・管理": `予約内容は管理画面から確認・管理できます。
空き状況や予約情報をまとめて確認できます。`,
  };

  await replyAndRemember(replyToken, userId, answers[input], solutionOptions());
}

async function replyReviewCouponFeature(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `CareLinkでは、利用者からの口コミを確認し、返信できます。
また、クーポンの作成・管理も行えます。

主な機能はこちらです。

・投稿された口コミの確認
・口コミへの返信
・クーポンの作成
・クーポン内容の変更・管理

どの内容を詳しく確認しますか？`,
    [
      { label: "口コミの確認・返信", text: "口コミの確認・返信" },
      { label: "クーポンの作成・管理", text: "クーポンの作成・管理" },
      { label: "別の機能を確認", text: "機能について" },
      { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
      { label: "解決した", text: "解決した" },
    ]
  );
}

async function replyReviewCouponDetail(replyToken, userId, input) {
  resetState(userId);

  const answers = {
    "口コミの確認・返信": `投稿された口コミは、管理画面から確認できます。
施設側から口コミへ返信することもできます。

特定の口コミの削除やトラブルについては、CareLinkカスタマーセンターへご相談ください。`,

    "クーポンの作成・管理": `管理画面からクーポンを作成し、内容の変更・管理を行えます。`,
  };

  await replyAndRemember(replyToken, userId, answers[input], solutionOptions());
}

async function replyStaffFeature(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `CareLinkでは、スタッフ情報や予約状況をスタッフごとに管理できます。

主な機能はこちらです。

・スタッフ情報の登録
・プロフィールや写真の掲載
・スタッフの指名予約
・指名料の設定
・スタッフごとの操作権限設定

どの内容を詳しく確認しますか？`,
    [
      { label: "スタッフ情報の登録", text: "スタッフ情報の登録" },
      { label: "指名予約・指名料", text: "指名予約・指名料" },
      { label: "操作権限について", text: "操作権限について" },
      { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
      { label: "解決した", text: "解決した" },
    ]
  );
}

async function replyStaffDetail(replyToken, userId, input) {
  resetState(userId);

  const answers = {
    "スタッフ情報の登録": `スタッフごとにプロフィールや写真などの情報を登録し、掲載できます。`,

    "指名予約・指名料": `お客様が予約時にスタッフを指名できるよう設定できます。
スタッフごとの指名料も設定可能です。`,

    "操作権限について": `スタッフごとに操作権限を設定できます。
担当する業務に応じて、利用できる機能を分けて管理できます。`,
  };

  await replyAndRemember(replyToken, userId, answers[input], solutionOptions());
}

async function replySalesCustomerFeature(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `CareLinkでは、売上や顧客情報を管理し、店舗運営に活用できます。

主な機能はこちらです。

・日別の売上確認
・顧客情報の管理
・リピート率の確認
・顧客データの分析

どの内容を詳しく確認しますか？`,
    [
      { label: "売上の確認", text: "売上の確認" },
      { label: "顧客情報の管理", text: "顧客情報の管理" },
      { label: "リピート率・顧客分析", text: "リピート率・顧客分析" },
      { label: "無料掲載登録へ進む", uri: CARELINK_REGISTER_URL },
      { label: "解決した", text: "解決した" },
    ]
  );
}

async function replySalesCustomerDetail(replyToken, userId, input) {
  resetState(userId);

  const answers = {
    "売上の確認": `管理画面から、日ごとの売上状況を確認できます。`,
    "顧客情報の管理": `予約や利用状況に関連する顧客情報を管理できます。`,
    "リピート率・顧客分析": `リピート率や顧客データを確認し、利用状況の分析に活用できます。`,
  };

  await replyAndRemember(replyToken, userId, answers[input], solutionOptions());
}

async function replyFeatureOverview(replyToken, userId) {
  await replyListingCapabilities(replyToken, userId);
}

async function replySolved(replyToken, userId) {
  resetState(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `お役に立ててよかったです😊
ほかにも気になることがありましたら、いつでもメッセージをお送りください。`,
    [{ label: "メニュー", text: "メニュー" }]
  );
}

async function replyMoreDetail(replyToken, userId) {
  setFlow(userId, "FREE_FOLLOWUP");
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `承知しました。
どの部分をもう少し確認したいですか？`
  );
}

async function replyOtherConsultation(replyToken, userId) {
  setFlow(userId, "FREE_CONSULTATION", true);
  incrementQuestionCount(userId);

  await replyAndRemember(
    replyToken,
    userId,
    `ご相談ありがとうございます。
気になっていることやお困りの内容を、そのまま入力してください。
内容を確認しながらご案内します。`
  );
}

async function startHandoff(replyToken, userId, reason = "USER_REQUEST") {
  setFlow(userId, "HANDOFF_WAIT", true);

  const text =
    reason === "SYSTEM_ISSUE"
      ? `ご不便をおかけして申し訳ありません。
Botでは解決が難しいため、CareLinkカスタマーセンターへおつなぎします。

現在の状況や表示されている内容を、分かる範囲でご記入ください。`
      : `CareLinkカスタマーセンターへおつなぎします。

確認したいことやお困りの内容を、下の入力欄からお気軽にご記入ください。

内容を確認後、順次ご案内いたします。`;

  await replyAndRemember(replyToken, userId, text, [
    { label: "メニュー", text: "メニュー" },
  ]);
}

async function completeHandoff(replyToken, userId) {
  await replyAndRemember(
    replyToken,
    userId,
    `ご相談内容を受け付けました。

CareLinkカスタマーセンターにて内容を確認後、順次ご案内いたします。

追加で伝えたいことがある場合は、続けてメッセージをお送りください。`,
    [{ label: "メニュー", text: "メニュー" }]
  );
}

function looksLikeSystemIssue(input) {
  return /エラー|不具合|動かない|開けない|進めない|表示されない|ログインできない|届かない|失敗|バグ|フリーズ|落ちる/i.test(
    String(input || "")
  );
}

const CLAUDE_KNOWLEDGE = `
【CareLinkの正式情報】

・初期費用、月額費用、掲載料、予約手数料、解約金は0円。
・最低契約期間はなく、クレジットカード登録も不要。
・掲載は、施設情報入力、アカウント作成、管理画面でメニューや写真登録、公開の順。
・最短3分で登録でき、最短当日から掲載開始。
・無料掲載登録URL：${CARELINK_REGISTER_URL}
・掲載案内URL：${CARELINK_SALON_URL}
・主な機能：メニュー・料金掲載、24時間オンライン予約、口コミ確認・返信、クーポン管理、スタッフ情報・指名予約・指名料、スタッフごとの操作権限、売上・顧客分析、写真管理、新規予約のリアルタイム通知。
・現在、外部予約サービスとの連携には対応していない。
・掲載情報は管理画面から変更できる。
・登録・掲載に資格証や開設届などの提出は現時点では不要。
・美容、医療・治療院、介護・福祉系の施設が掲載対象。
・掲載対象か判断できない業種は、推測せずCareLinkカスタマーセンターへ案内する。
・特定の口コミ削除やトラブル、システムエラーなどBotで解決できない不具合はCareLinkカスタマーセンターへ案内する。
`;

const CLAUDE_SYSTEM_PROMPT = [
  "あなたはCareLinkのLINEお問い合わせAIです。",
  "ユーザーの悩みを自然に整理し、必要な情報だけを案内してください。",
  "具体的な質問にはすぐ回答してください。",
  "曖昧な場合だけ、不足情報を1回につき1つ質問してください。",
  "質問は基本1〜2回、最大3回までです。",
  "既にユーザーが答えた内容を聞き直してはいけません。",
  "ユーザーの返答を短く受け止め、毎回同じ言い回しを使わないでください。",
  "回答はLINE向けに短くし、長い列挙は箇条書きにしてください。",
  "以下の正式情報だけを使用し、推測・一般論・未確認情報で回答してはいけません。",
  CLAUDE_KNOWLEDGE,
  "回答できない内容、個別判断、特定の口コミトラブル、システムエラーはhandoffをtrueにしてください。",
  "複数の相談がある場合は、どちらから確認するか1つだけ質問してください。",
  "optionsは、次の候補から必要なものだけ最大4件選んでください。",
  "掲載について,料金について,登録・使い方,機能について,その他の相談,掲載までの流れ,登録に必要な情報,予約機能,口コミ・クーポン,スタッフ管理,売上・顧客分析,無料掲載登録へ進む,解決した,もう少し確認したい,メニュー,カスタマーセンターに相談",
  "出力はJSONだけにしてください。",
  '{"text":"返信本文","options":["候補"],"handoff":false,"systemIssue":false,"askQuestion":false}',
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

function normalizeClaudeOptions(options) {
  const optionMap = {
    掲載について: { label: "掲載について", text: "掲載について" },
    料金について: { label: "料金について", text: "料金について" },
    "登録・使い方": { label: "登録・使い方", text: "登録・使い方" },
    機能について: { label: "機能について", text: "機能について" },
    その他の相談: { label: "その他の相談", text: "その他の相談" },
    掲載までの流れ: {
      label: "掲載までの流れ",
      text: "掲載までの流れ",
    },
    登録に必要な情報: {
      label: "登録に必要な情報",
      text: "登録に必要な情報",
    },
    予約機能: { label: "予約機能", text: "予約機能" },
    "口コミ・クーポン": {
      label: "口コミ・クーポン",
      text: "口コミ・クーポン",
    },
    スタッフ管理: { label: "スタッフ管理", text: "スタッフ管理" },
    "売上・顧客分析": {
      label: "売上・顧客分析",
      text: "売上・顧客分析",
    },
    無料掲載登録へ進む: {
      label: "無料掲載登録へ進む",
      uri: CARELINK_REGISTER_URL,
    },
    解決した: { label: "解決した", text: "解決した" },
    もう少し確認したい: {
      label: "もう少し確認",
      text: "もう少し確認したい",
    },
    メニュー: { label: "メニュー", text: "メニュー" },
    カスタマーセンターに相談: {
      label: "カスタマーセンター",
      text: "カスタマーセンターに相談",
    },
  };

  if (!Array.isArray(options)) return [];

  return options
    .map((option) => canonicalizeInput(option))
    .filter((option) => optionMap[option])
    .slice(0, 4)
    .map((option) => optionMap[option]);
}

async function claudeFallback(replyToken, userId, input) {
  const state = getState(userId);

  if (state.questionCount >= 3) {
    await startHandoff(replyToken, userId, "USER_REQUEST");
    return;
  }

  if (looksLikeSystemIssue(input)) {
    await startHandoff(replyToken, userId, "SYSTEM_ISSUE");
    return;
  }

  if (!CLAUDE_API_KEY) {
    await replyAndRemember(
      replyToken,
      userId,
      `お問い合わせありがとうございます。
内容に近い項目を選ぶか、入力欄から自由にご相談ください。`,
      topMenuOptions()
    );
    return;
  }

  try {
    const recentHistory = (state.history || [])
      .slice(-6)
      .map(
        (item) =>
          `${item.role === "user" ? "ユーザー" : "Bot"}：${item.content}`
      )
      .join("\n");

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: CLAUDE_MODEL,
        max_tokens: 700,
        temperature: 0.2,
        system: CLAUDE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `現在の会話状態：${state.flow}
質問回数：${state.questionCount}

直近の会話：
${recentHistory || "なし"}

今回のユーザー入力：
${input}`,
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

    if (!parsed?.text) {
      throw new Error("Claude returned invalid JSON");
    }

    if (parsed.handoff) {
      await startHandoff(
        replyToken,
        userId,
        parsed.systemIssue ? "SYSTEM_ISSUE" : "USER_REQUEST"
      );
      return;
    }

    if (parsed.askQuestion) {
      incrementQuestionCount(userId);
    }

    const options = normalizeClaudeOptions(parsed.options);

    await replyAndRemember(
      replyToken,
      userId,
      parsed.text,
      options.length > 0 ? options : solutionOptions()
    );
  } catch (error) {
    console.error(
      "Claude API error:",
      error?.response?.data || error?.message
    );

    await replyAndRemember(
      replyToken,
      userId,
      `申し訳ありません。
現在、内容をうまく確認できませんでした。

近い項目を選ぶか、CareLinkカスタマーセンターへご相談ください。`,
      [
        { label: "掲載について", text: "掲載について" },
        { label: "料金について", text: "料金について" },
        { label: "登録・使い方", text: "登録・使い方" },
        {
          label: "カスタマーセンター",
          text: "カスタマーセンターに相談",
        },
      ]
    );
  }
}

function isPriceAnswer(input) {
  return [
    "初期費用",
    "月額料金",
    "予約手数料",
    "契約期間・解約",
    "料金全体",
  ].includes(input);
}

function isReservationDetail(input) {
  return [
    "予約の受付方法",
    "スタッフの指名予約",
    "予約通知について",
    "予約内容の確認・管理",
  ].includes(input);
}

function isReviewCouponDetail(input) {
  return ["口コミの確認・返信", "クーポンの作成・管理"].includes(input);
}

function isStaffDetail(input) {
  return ["スタッフ情報の登録", "指名予約・指名料", "操作権限について"].includes(
    input
  );
}

function isSalesCustomerDetail(input) {
  return ["売上の確認", "顧客情報の管理", "リピート率・顧客分析"].includes(
    input
  );
}

app.post("/webhook", async (req, res) => {
  if (!validateLineSignature(req)) {
    return res.status(401).send("Invalid signature");
  }

  /**
   * LINEへ先に200を返します。
   */
  res.status(200).send("OK");

  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  for (const event of events) {
    try {
      const userId = event.source?.userId || "";
      const replyToken = event.replyToken;

      /**
       * 友だち追加時
       */
      if (event.type === "follow") {
        resetState(userId);
        await showLoading(userId, 5);
        await sleep(800);
        await replyTopMenu(replyToken, userId, true);
        continue;
      }

      /**
       * テキスト以外は処理しません。
       */
      if (event.type !== "message" || event.message?.type !== "text") {
        continue;
      }

      const input = canonicalizeInput(event.message.text);
      const state = getState(userId);

      appendHistory(userId, "user", input);
      await saveLog(userId, input, state.flow);
      await showLoading(userId, 5);
      await sleep(800);

      /**
       * メニュー復帰
       */
      if (input === "メニュー") {
        resetState(userId);
        await replyTopMenu(replyToken, userId, false);
        continue;
      }

      /**
       * カスタマーセンター相談内容受信
       */
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
        await completeHandoff(replyToken, userId);
        continue;
      }

      /**
       * カスタマーセンター相談開始
       */
      if (input === "カスタマーセンターに相談") {
        await startHandoff(replyToken, userId, "USER_REQUEST");
        continue;
      }

      /**
       * 解決確認
       */
      if (input === "解決した") {
        await replySolved(replyToken, userId);
        continue;
      }

      if (input === "もう少し確認したい") {
        await replyMoreDetail(replyToken, userId);
        continue;
      }

      /**
       * 掲載について
       */
      if (input === "掲載について") {
        await replyListingMenu(replyToken, userId);
        continue;
      }

      if (input === "業種が掲載対象か") {
        await askIndustry(replyToken, userId);
        continue;
      }

      if (state.flow === "LISTING_INDUSTRY_WAIT") {
        await replyIndustryResult(replyToken, userId, input);
        continue;
      }

      if (input === "掲載までの流れ") {
        await replyListingFlow(replyToken, userId);
        continue;
      }

      if (input === "登録に必要な情報") {
        await replyRegistrationRequirements(replyToken, userId);
        continue;
      }

      if (input === "掲載すると何ができるか") {
        await replyListingCapabilities(replyToken, userId);
        continue;
      }

      if (input === "まだ具体的に決まっていない") {
        await replyUnclearGoal(replyToken, userId);
        continue;
      }

      if (input === "新しいお客様に知ってもらいたい") {
        await replyListingCapabilities(replyToken, userId);
        continue;
      }

      if (input === "予約を受け付けたい") {
        await replyReservationFeature(replyToken, userId);
        continue;
      }

      if (input === "口コミを活用したい") {
        await replyReviewCouponFeature(replyToken, userId);
        continue;
      }

      if (input === "顧客やスタッフを管理したい") {
        await replyStaffFeature(replyToken, userId);
        continue;
      }

      if (input === "CareLink全体を知りたい") {
        await replyFeatureOverview(replyToken, userId);
        continue;
      }

      /**
       * 料金
       */
      if (input === "料金について") {
        await replyPriceMenu(replyToken, userId);
        continue;
      }

      if (isPriceAnswer(input)) {
        await replyPriceAnswer(replyToken, userId, input);
        continue;
      }

      /**
       * 登録・使い方
       */
      if (input === "登録・使い方") {
        await replyRegistrationMenu(replyToken, userId);
        continue;
      }

      if (input === "これから登録したい") {
        await replyRegistrationRequirements(replyToken, userId);
        continue;
      }

      if (input === "登録方法を知りたい") {
        await replyListingFlow(replyToken, userId);
        continue;
      }

      if (input === "登録後の使い方") {
        await replyAfterRegistrationMenu(replyToken, userId);
        continue;
      }

      if (input === "掲載情報を変更したい") {
        await replyListingEdit(replyToken, userId);
        continue;
      }

      /**
       * 機能について
       */
      if (input === "機能について") {
        await replyFeatureMenu(replyToken, userId);
        continue;
      }

      if (input === "機能全体") {
        await replyFeatureOverview(replyToken, userId);
        continue;
      }

      if (input === "予約機能") {
        await replyReservationFeature(replyToken, userId);
        continue;
      }

      if (isReservationDetail(input)) {
        await replyReservationDetail(replyToken, userId, input);
        continue;
      }

      if (input === "口コミ・クーポン") {
        await replyReviewCouponFeature(replyToken, userId);
        continue;
      }

      if (isReviewCouponDetail(input)) {
        await replyReviewCouponDetail(replyToken, userId, input);
        continue;
      }

      if (input === "スタッフ管理") {
        await replyStaffFeature(replyToken, userId);
        continue;
      }

      if (isStaffDetail(input)) {
        await replyStaffDetail(replyToken, userId, input);
        continue;
      }

      if (input === "売上・顧客分析") {
        await replySalesCustomerFeature(replyToken, userId);
        continue;
      }

      if (isSalesCustomerDetail(input)) {
        await replySalesCustomerDetail(replyToken, userId, input);
        continue;
      }

      /**
       * その他の相談
       */
      if (input === "その他の相談") {
        await replyOtherConsultation(replyToken, userId);
        continue;
      }

      /**
       * それ以外の自由入力はClaudeへ送ります。
       */
      await claudeFallback(replyToken, userId, input);
    } catch (error) {
      console.error(
        "Webhook event error:",
        error?.response?.data || error?.message
      );
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
