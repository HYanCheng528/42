export function notifyPushPlusSafe(cfg, message, { onSuccess = null, onError = null } = {}) {
  if (!cfg?.pushPlusEnabled || !cfg.pushPlusToken) return false;
  void sendPushPlus(cfg, message).then((result) => {
    onSuccess?.(result);
  }).catch((error) => {
    onError?.(error);
    console.error(JSON.stringify({
      level: "warn",
      source: "pushplus",
      message: redactPushPlusError(error),
      at: new Date().toISOString()
    }));
  });
  return true;
}

export async function sendPushPlus(cfg, { title, content }) {
  if (!cfg?.pushPlusEnabled || !cfg.pushPlusToken) {
    return { ok: false, skipped: true };
  }

  const response = await fetch(cfg.pushPlusUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(cfg.pushPlusTimeoutMs ?? 10000),
    body: JSON.stringify({
      token: cfg.pushPlusToken,
      title: String(title ?? "42space bot"),
      content: String(content ?? ""),
      template: cfg.pushPlusTemplate || "markdown"
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`PushPlus HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  try {
    const json = JSON.parse(text);
    if (json.code !== 200 && json.code !== 0) {
      throw new Error(`PushPlus rejected: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return { ok: true, response: json };
  } catch (error) {
    if (error.message?.startsWith("PushPlus rejected")) throw error;
    return { ok: true, responseText: text.slice(0, 200) };
  }
}

export function shortHash(value) {
  const text = String(value ?? "");
  if (text.length <= 14) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

export function markdownLine(label, value) {
  if (value === undefined || value === null || value === "") return "";
  return `- ${label}: ${String(value)}`;
}

function redactPushPlusError(error) {
  return String(error?.message ?? error).replace(/[A-Za-z0-9]{20,}/g, "[redacted]");
}
