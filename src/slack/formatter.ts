// Formats agent responses into Slack Block Kit messages

import type { ParsedMedicalMessage, AgentAction } from "../core/types.js";

interface AgentResult {
  reasoning: string;
  action: AgentAction;
  slackMessage: string;
  requiresPhysicianReview: boolean;
  urgency: string;
}

export function formatSlackResponse(
  result: AgentResult,
  message: ParsedMedicalMessage
): unknown[] {
  const urgencyEmoji = getUrgencyEmoji(result.urgency);
  const actionLabel = getActionLabel(result.action);

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${urgencyEmoji} OpenClaw: ${message.content.subject}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Patient:* ${message.patient.lastName}, ${message.patient.firstName}`,
        },
        {
          type: "mrkdwn",
          text: `*MRN:* ${message.patient.mrn}`,
        },
        {
          type: "mrkdwn",
          text: `*Type:* ${message.messageType}`,
        },
        {
          type: "mrkdwn",
          text: `*Urgency:* ${result.urgency.toUpperCase()}`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Action Taken:* ${actionLabel}\n\n${result.slackMessage}`,
      },
    },
  ];

  // Add lab results table if present
  if (message.content.labResults?.length) {
    const labText = message.content.labResults
      .map((r) => {
        const flagStr = r.flag === "critical" ? " :red_circle:" : r.flag === "abnormal" ? " :large_orange_circle:" : "";
        return `\`${r.testName}\`: *${r.value}* ${r.units} (ref: ${r.referenceRange})${flagStr}`;
      })
      .join("\n");

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Lab Results:*\n${labText}` },
    });
  }

  // Epic deep link button
  if (message.epicDeepLink) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Epic Haiku" },
          url: message.epicDeepLink,
          style: "primary",
        },
      ],
    });
  }

  // Physician review banner
  if (result.requiresPhysicianReview) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:rotating_light: *Physician Review Required* — ${result.reasoning.slice(0, 200)}`,
        },
      }
    );
  }

  // Agent reasoning (collapsed context)
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Agent reasoning: ${result.reasoning.slice(0, 300)}`,
      },
    ],
  });

  return blocks;
}

function getUrgencyEmoji(urgency: string): string {
  switch (urgency) {
    case "critical": return ":red_circle:";
    case "stat": return ":large_orange_circle:";
    case "urgent": return ":large_yellow_circle:";
    default: return ":white_circle:";
  }
}

function getActionLabel(action: AgentAction): string {
  switch (action.type) {
    case "ORDER_LAB": return "Lab Order Placed";
    case "SEND_FOLLOW_UP": return "Follow-Up Sent";
    case "SCHEDULE_STUDY": return "Study Scheduled";
    case "CALL_OFFICE": return "Office Call Routed";
    case "MEDICATION_REFILL": return "Medication Refill Processed";
    case "ACKNOWLEDGE": return "Acknowledged";
    case "ESCALATE": return "Escalated to Physician";
    case "NO_ACTION": return "No Action Required";
  }
}
