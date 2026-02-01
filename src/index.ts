// OpenClaw Medical Agent - Main Entry Point
// Connects Anthropic Opus 4.5 <-> Slack <-> Epic Haiku
// Supports multiple ingestion modes: Slack, Webhook (Workato/FHIR), or Both

import { loadConfig } from "./core/config.js";
import { MedicalAgent } from "./core/agent.js";
import { SlackBot } from "./slack/bot.js";
import { ClarityAdapter } from "./clarity/adapter.js";
import { TaskDispatcher } from "./tasks/dispatcher.js";
import { WorkatoWebhook } from "./workato/webhook.js";
import { formatSlackResponse } from "./slack/formatter.js";

async function main() {
  console.log("===========================================");
  console.log("  OpenClaw Medical Agent v0.2.0");
  console.log("  Anthropic Opus 4.5 + Slack + Epic Haiku");
  console.log("  + Community Connect + Workato Support");
  console.log("===========================================\n");

  // Load configuration
  const config = loadConfig();
  console.log(`[Config] Model: ${config.anthropic.model}`);
  console.log(`[Config] Physician: ${config.agent.physicianName}`);
  console.log(`[Config] Ingestion mode: ${config.ingestion.mode}`);
  console.log(`[Config] Slack Channel: ${config.slack.medicalChannelId}`);
  console.log(`[Config] Epic Base: ${config.epic.haikuBaseUrl}`);
  if (config.workato) {
    console.log(`[Config] Webhook port: ${config.workato.webhookPort}`);
  }
  console.log();

  // Initialize components
  const agent = new MedicalAgent(config);
  const clarity = new ClarityAdapter(config);
  const dispatcher = new TaskDispatcher(clarity);

  let slackBot: SlackBot | null = null;
  let webhook: WorkatoWebhook | null = null;

  // Start ingestion based on mode
  const mode = config.ingestion.mode;

  if (mode === "slack" || mode === "both") {
    slackBot = new SlackBot(config, agent);
    await slackBot.start();
  }

  if (mode === "webhook" || mode === "both") {
    // When in webhook or both mode, webhook results get posted to Slack
    // via the Slack Web API (the bot must still be configured)
    webhook = new WorkatoWebhook(config, agent, async (result, message) => {
      // If Slack bot is running, post results to the medical channel
      if (slackBot) {
        // The SlackBot handles posting internally
        console.log(`[Webhook->Slack] Forwarding result for MRN ${message.patient.mrn}: ${result.action}`);
      } else {
        // Log only — in webhook-only mode, results return via HTTP response
        console.log(`[Webhook] Processed MRN ${message.patient.mrn}: ${result.action} (review: ${result.requiresReview})`);
      }
    });
    await webhook.start();
  }

  if (!slackBot && !webhook) {
    console.error("[OpenClaw] No ingestion mode active. Set INGESTION_MODE to 'slack', 'webhook', or 'both'.");
    process.exit(1);
  }

  // Register shutdown handlers
  const shutdown = async () => {
    console.log("\n[OpenClaw] Shutting down...");
    if (slackBot) await slackBot.stop();
    if (webhook) await webhook.stop();
    const auditLog = agent.getAuditLog();
    console.log(`[OpenClaw] Processed ${auditLog.length} messages this session.`);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[OpenClaw] Agent is live. Listening for medical messages...");
  if (mode === "slack" || mode === "both") {
    console.log("[OpenClaw]   Slack: listening on channel " + config.slack.medicalChannelId);
  }
  if (mode === "webhook" || mode === "both") {
    console.log(`[OpenClaw]   Webhook: listening on port ${config.workato?.webhookPort ?? 3100}`);
    console.log("[OpenClaw]     POST /webhook/workato  — Workato recipe delivery");
    console.log("[OpenClaw]     POST /webhook/fhir     — FHIR R4 (Community Connect)");
    console.log("[OpenClaw]     POST /webhook/hl7      — Raw HL7v2");
  }
  console.log("[OpenClaw] Press Ctrl+C to stop.\n");
}

main().catch((error) => {
  console.error("[OpenClaw] Fatal error:", error);
  process.exit(1);
});
