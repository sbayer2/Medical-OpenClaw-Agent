// Slack Bolt integration - listens for messages and dispatches to agent

import { App, type MessageEvent } from "@slack/bolt";
import type { Config } from "../core/config.js";
import type { MedicalAgent } from "../core/agent.js";
import type { ParsedMedicalMessage, SlackMessageContext } from "../core/types.js";
import { HL7Parser } from "../epic/hl7-parser.js";
import { EpicDeepLinks } from "../epic/deep-links.js";
import { formatSlackResponse } from "./formatter.js";

export class SlackBot {
  private app: App;
  private agent: MedicalAgent;
  private hl7Parser: HL7Parser;
  private deepLinks: EpicDeepLinks;
  private medicalChannelId: string;

  constructor(config: Config, agent: MedicalAgent) {
    this.app = new App({
      token: config.slack.botToken,
      appToken: config.slack.appToken,
      socketMode: true,
      signingSecret: config.slack.signingSecret,
    });

    this.agent = agent;
    this.hl7Parser = new HL7Parser();
    this.deepLinks = new EpicDeepLinks(config.epic.haikuBaseUrl);
    this.medicalChannelId = config.slack.medicalChannelId;

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // Listen for messages in the medical channel
    this.app.message(async ({ message, say }) => {
      const msg = message as MessageEvent & { text?: string; channel?: string; thread_ts?: string; user?: string };

      // Only process messages in the designated medical channel
      if (msg.channel !== this.medicalChannelId) return;

      // Skip bot messages to avoid loops
      if (msg.subtype === "bot_message" || !msg.text) return;

      const context: SlackMessageContext = {
        channelId: msg.channel,
        threadTs: msg.thread_ts ?? msg.ts,
        userId: msg.user ?? "unknown",
        text: msg.text,
      };

      try {
        await this.handleMedicalMessage(context, say);
      } catch (error) {
        console.error("[OpenClaw] Error processing message:", error);
        await say({
          text: `[OpenClaw] Error processing message. Escalating to physician.\n\`\`\`${String(error)}\`\`\``,
          thread_ts: context.threadTs,
        });
      }
    });

    // Slash command for agent status
    this.app.command("/openclaw-status", async ({ command, ack, respond }) => {
      await ack();
      const auditLog = this.agent.getAuditLog();
      await respond({
        text: `*OpenClaw Agent Status*\n- Messages processed: ${auditLog.length}\n- Last action: ${auditLog.at(-1)?.actionTaken.type ?? "None"}\n- Model: claude-opus-4-5-20251101`,
      });
    });

    // Slash command to view audit log
    this.app.command("/openclaw-audit", async ({ command, ack, respond }) => {
      await ack();
      const auditLog = this.agent.getAuditLog();
      const recent = auditLog.slice(-5);
      const formatted = recent
        .map(
          (entry) =>
            `*${entry.timestamp}* | MRN: ${entry.patientMrn} | Action: ${entry.actionTaken.type}\nReasoning: ${entry.agentReasoning.slice(0, 150)}...`
        )
        .join("\n---\n");
      await respond({
        text: `*Recent Audit Log (last 5)*\n\n${formatted || "No entries yet."}`,
      });
    });
  }

  private async handleMedicalMessage(
    context: SlackMessageContext,
    say: (msg: { text: string; blocks?: unknown[]; thread_ts?: string }) => Promise<unknown>
  ): Promise<void> {
    // Try to parse as HL7 or as pre-converted JSON from Clarity Connect
    let parsedMessage: ParsedMedicalMessage;

    if (this.looksLikeHL7(context.text)) {
      parsedMessage = this.hl7Parser.parse(context.text);
    } else {
      try {
        parsedMessage = JSON.parse(context.text) as ParsedMedicalMessage;
      } catch {
        // Not HL7 and not JSON - might be a human message, skip
        return;
      }
    }

    // Add Epic deep link
    parsedMessage.epicDeepLink = this.deepLinks.buildPatientChartLink(
      parsedMessage.patient.epicPatientId
    );

    // Process with the agent
    const result = await this.agent.processMessage(parsedMessage);

    // Format and send response
    const slackBlocks = formatSlackResponse(result, parsedMessage);

    await say({
      text: result.slackMessage,
      blocks: slackBlocks,
      thread_ts: context.threadTs,
    });

    // If physician review needed, send a DM or mention
    if (result.requiresPhysicianReview) {
      await say({
        text: `@here *[PHYSICIAN REVIEW REQUIRED]* - ${result.urgency.toUpperCase()}\n${result.slackMessage}`,
        thread_ts: context.threadTs,
      });
    }
  }

  private looksLikeHL7(text: string): boolean {
    return text.startsWith("MSH|") || text.includes("\rMSH|") || text.includes("\nMSH|");
  }

  async start(): Promise<void> {
    await this.app.start();
    console.log("[OpenClaw] Slack bot connected and listening");
  }

  async stop(): Promise<void> {
    await this.app.stop();
    console.log("[OpenClaw] Slack bot disconnected");
  }
}
