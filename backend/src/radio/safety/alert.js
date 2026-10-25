/**
 * alert.js — tell DrJ now: a macOS notification on the Mac mini, email (SMTP_* + RADIO_ALERT_EMAIL), and a
 * phone push when RADIO_ALERT_PUSH_URL is set (an ntfy topic URL, e.g. https://ntfy.sh/<private-topic>:
 * the message is POSTed as plain text; unset = no push). Same channels as autoair's alerts, plus the push.
 * Every channel is best effort and independent: one failing never stops the others.
 */
import { spawnSync } from "node:child_process";

export function makeRadioAlert({ env = process.env, log = () => {}, platform = process.platform, fetchImpl = globalThis.fetch, mailer = null } = {}) {
  return async (msg, { quiet = false, title = "ScoopFeeds Radio" } = {}) => {
    const sent = [];
    log(`${quiet ? "ℹ" : "⚠"} ${msg}`);
    if (platform === "darwin") {
      const r = spawnSync("osascript", ["-e", `display notification ${JSON.stringify(msg.slice(0, 200))} with title ${JSON.stringify(title)}`], { stdio: "ignore" });
      if (r.status === 0) sent.push("mac");
    }
    const push = String(env.RADIO_ALERT_PUSH_URL || "").trim();
    if (push && fetchImpl) {
      try {
        const r = await fetchImpl(push, { method: "POST", headers: { Title: title, Priority: quiet ? "default" : "urgent", "Content-Type": "text/plain; charset=utf-8" }, body: msg });
        if (r.ok) sent.push("push"); else log(`push alert failed: HTTP ${r.status}`);
      } catch (e) { log(`push alert failed: ${e.message}`); }
    }
    const to = env.RADIO_ALERT_EMAIL;
    if (to && (env.SMTP_HOST || mailer)) {
      try {
        const send = mailer || (await import("../../services/mailer.js")).sendMail;
        await send({ to, subject: `${quiet ? "" : "⚠ "}${title}: ${msg.slice(0, 80)}`, text: msg });
        sent.push("email");
      } catch (e) { log(`alert email failed: ${e.message}`); }
    }
    if (!sent.length) log("alert reached no channel beyond this log: set RADIO_ALERT_EMAIL + SMTP_* and/or RADIO_ALERT_PUSH_URL");
    return sent;
  };
}
