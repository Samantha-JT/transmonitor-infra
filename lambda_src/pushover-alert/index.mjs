const PUSHOVER_API = "https://api.pushover.net/1/messages.json";

export const handler = async (event) => {
  const token = process.env.PUSHOVER_TOKEN;
  const user  = process.env.PUSHOVER_USER;
  if (!token || !user) {
    console.error("Pushover credentials not configured");
    return;
  }

  for (const record of event.Records ?? []) {
    let message, title, priority;

    try {
      const sns     = JSON.parse(record.Sns?.Message ?? "{}");
      const state   = sns.NewStateValue;
      const reason  = sns.NewStateReason;
      const alarm   = sns.AlarmName;
      const metric  = sns.Trigger?.MetricName;

      const isAlert = state === "ALARM";
      const isOk    = state === "OK";

      title    = isAlert ? `🚨 TransMonitor: ${alarm}` : `✅ TransMonitor: ${alarm} recovered`;
      message  = isAlert
        ? `<b>Alarm:</b> ${alarm}\n<b>Metric:</b> ${metric}\n<b>Reason:</b> ${reason}`
        : `<b>${alarm}</b> has recovered.\n${reason}`;
      priority = isAlert ? 1 : -1;

    } catch (err) {
      title    = "⚠️ TransMonitor: CloudWatch Alert";
      message  = `Raw event: ${JSON.stringify(record).slice(0, 500)}`;
      priority = 0;
    }

    await fetch(PUSHOVER_API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, user, title, message, priority, html: 1 }),
    });
  }
};
