// Post one line about the production deploy to Slack. A failed notification is only
// logged: it must not hide the deploy result it is reporting.
const token = process.env.SLACK_BOT_TOKEN;
const channel = process.env.SLACK_DEFAULT_CHANNEL;
const text = process.argv.slice(2).join(' ');

if (!token || !channel || !text) {
  console.warn('Slack 通知を送れない（トークン・チャンネル・本文のいずれかが無い）');
} else {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text }),
    });
    const body = await res.json();
    if (!body.ok) console.warn(`Slack 通知に失敗: ${body.error}`);
  } catch (error) {
    console.warn(`Slack 通知に失敗: ${error.message}`);
  }
}
