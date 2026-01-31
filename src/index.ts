// OpenClaw Medical Agent - Main Entry Point
// Connects Anthropic Opus 4.5 ↔ Slack ↔ Epic Haiku via Clarity Connect

import { loadConfig } from "./core/config.js";
import { MedicalAgent } from "./core/agent.js";
import { SlackBot } from "./slack/bot.js";
import { ClarityAdapter } from "./clarity/adapter.js";
import { TaskDispatcher } from "./tasks/dispatcher.js";

async function main() {
  console.log("===========================================");
  console.log("  OpenClaw Medical Agent v0.1.0");
  console.log("  Anthropic Opus 4.5 + Slack + Epic Haiku");
  console.log("===========================================\n");

  // Load configuration
  const config = loadConfig();
  console.log(`[Config] Model: ${config.anthropic.model}`);
  console.log(`[Config] Physician: ${config.agent.physicianName}`);
  console.log(`[Config] Slack Channel: ${config.slack.medicalChannelId}`);
  console.log(`[Config] Epic Base: ${config.epic.haikuBaseUrl}\n`);

  // Initialize components
  const agent = new MedicalAgent(config);
  const clarity = new ClarityAdapter(config);
  const dispatcher = new TaskDispatcher(clarity);
  const slackBot = new SlackBot(config, agent);

  // Register shutdown handlers
  const shutdown = async () => {
    console.log("\n[OpenClaw] Shutting down...");
    await slackBot.stop();
    const auditLog = agent.getAuditLog();
    console.log(`[OpenClaw] Processed ${auditLog.length} messages this session.`);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the bot
  await slackBot.start();

  console.log("[OpenClaw] Agent is live. Listening for medical messages...");
  console.log("[OpenClaw] Press Ctrl+C to stop.\n");
}

main().catch((error) => {
  console.error("[OpenClaw] Fatal error:", error);
  process.exit(1);
});
