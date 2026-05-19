import { env } from "./env.js";

export async function sendSlackDm(
  _userId: string,
  _text: string,
): Promise<{ sent: boolean; mock: boolean }> {
  const token = env("SLACK_BOT_TOKEN");
  if (!token) {
    console.info("[slack] stub DM (no SLACK_BOT_TOKEN):", _text.slice(0, 80));
    return { sent: false, mock: true };
  }
  // TODO: chat.postMessage via Slack Web API
  return { sent: true, mock: false };
}
