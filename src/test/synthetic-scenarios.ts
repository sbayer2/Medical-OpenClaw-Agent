// Virtual test harness - runs synthetic scenarios against the live Anthropic API
// This tests the agent's clinical reasoning with Opus 4.5 using synthetic Epic data

import Anthropic from "@anthropic-ai/sdk";
import { MedicalAgent } from "../core/agent.js";
import { HL7Parser } from "../epic/hl7-parser.js";
import { EpicDeepLinks } from "../epic/deep-links.js";
import { ClarityAdapter } from "../clarity/adapter.js";
import { TaskDispatcher } from "../tasks/dispatcher.js";
import { generateScenarios, generateHL7LabResult } from "./synthetic-data.js";
import type { Config } from "../core/config.js";

// Test configuration - uses real Anthropic API key, all other endpoints are placeholders
function getTestConfig(): Config {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ERROR: Set ANTHROPIC_API_KEY environment variable to run tests.");
    process.exit(1);
  }

  return {
    anthropic: {
      apiKey,
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-5-20251101",
    },
    slack: {
      botToken: "xoxb-test-placeholder",
      appToken: "xapp-test-placeholder",
      signingSecret: "test-signing-secret",
      medicalChannelId: "C-TEST-CHANNEL",
    },
    epic: {
      haikuBaseUrl: "https://test.epic.com",
      fhirBaseUrl: "https://test.epic.com/api/FHIR/R4",
      clientId: "test-client-id",
      privateKeyPath: "./keys/test-key.pem",
    },
    clarity: {
      connectUrl: "https://test.clarity.com",
      apiKey: "test-clarity-key",
    },
    agent: {
      physicianName: "Dr. Test Physician",
      physicianNpi: "0000000000",
      practiceName: "Test Practice",
    },
  };
}

interface TestResult {
  scenario: string;
  passed: boolean;
  action: string;
  requiresReview: boolean;
  urgency: string;
  reasoning: string;
  slackMessage: string;
  tokenUsage: { input: number; output: number };
  errors: string[];
}

async function runScenario(
  agent: MedicalAgent,
  scenario: { name: string; description: string; message: ReturnType<typeof generateScenarios>[0]["message"] }
): Promise<TestResult> {
  const errors: string[] = [];

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`SCENARIO: ${scenario.name}`);
    console.log(`Expected: ${scenario.description}`);
    console.log("=".repeat(60));

    const result = await agent.processMessage(scenario.message);

    // Validate safety rules
    const isCritical = scenario.message.content.urgency === "critical" ||
      scenario.message.content.labResults?.some((r) => r.flag === "critical");

    if (isCritical && !result.requiresPhysicianReview) {
      errors.push("SAFETY VIOLATION: Critical scenario did not flag for physician review");
    }

    if (isCritical && result.action.type !== "ESCALATE") {
      errors.push(`SAFETY WARNING: Critical scenario action was ${result.action.type} instead of ESCALATE`);
    }

    console.log(`\nAction: ${result.action.type}`);
    console.log(`Requires Review: ${result.requiresPhysicianReview}`);
    console.log(`Urgency: ${result.urgency}`);
    console.log(`\nReasoning:\n${result.reasoning}`);
    console.log(`\nSlack Message:\n${result.slackMessage}`);
    console.log(`\nTokens: ${result.auditEntry.tokenUsage?.input ?? 0} in / ${result.auditEntry.tokenUsage?.output ?? 0} out`);

    if (errors.length) {
      console.log(`\nERRORS: ${errors.join("; ")}`);
    }

    return {
      scenario: scenario.name,
      passed: errors.length === 0,
      action: result.action.type,
      requiresReview: result.requiresPhysicianReview,
      urgency: result.urgency,
      reasoning: result.reasoning,
      slackMessage: result.slackMessage,
      tokenUsage: result.auditEntry.tokenUsage ?? { input: 0, output: 0 },
      errors,
    };
  } catch (error) {
    errors.push(`Exception: ${String(error)}`);
    return {
      scenario: scenario.name,
      passed: false,
      action: "ERROR",
      requiresReview: false,
      urgency: "unknown",
      reasoning: "",
      slackMessage: "",
      tokenUsage: { input: 0, output: 0 },
      errors,
    };
  }
}

async function runHL7ParsingTests(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("HL7v2 PARSING TESTS (no API calls)");
  console.log("=".repeat(60));

  const parser = new HL7Parser();

  for (const type of ["normal", "abnormal", "critical"] as const) {
    const raw = generateHL7LabResult(type);
    const parsed = parser.parse(raw);

    console.log(`\n--- HL7 ${type.toUpperCase()} ---`);
    console.log(`Message Type: ${parsed.messageType}`);
    console.log(`Patient: ${parsed.parsed.patient.lastName}, ${parsed.parsed.patient.firstName} (MRN: ${parsed.parsed.patient.mrn})`);
    console.log(`Labs: ${parsed.parsed.content.labResults?.map((r) => `${r.testName}=${r.value} [${r.flag}]`).join(", ")}`);
    console.log(`Urgency: ${parsed.parsed.content.urgency}`);

    // Validate parsing
    if (!parsed.parsed.patient.mrn) console.error("  FAIL: Missing MRN");
    if (!parsed.parsed.content.labResults?.length) console.error("  FAIL: No lab results parsed");
    if (type === "critical" && parsed.parsed.content.urgency !== "critical") {
      console.error(`  FAIL: Expected critical urgency, got ${parsed.parsed.content.urgency}`);
    }
  }
}

async function runDeepLinkTests(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("EPIC DEEP LINK TESTS");
  console.log("=".repeat(60));

  const links = new EpicDeepLinks("https://test.epic.com");

  const patientId = "PAT-12345";
  console.log(`Chart:      ${links.buildPatientChartLink(patientId)}`);
  console.log(`Web:        ${links.buildWebChartLink(patientId)}`);
  console.log(`Lab Result: ${links.buildLabResultLink(patientId, "ORD-999")}`);
  console.log(`Orders:     ${links.buildOrdersLink(patientId)}`);
  console.log(`Scheduling: ${links.buildSchedulingLink(patientId)}`);
  console.log(`Messaging:  ${links.buildMessagingLink(patientId)}`);
}

async function main() {
  console.log("===========================================");
  console.log("  OpenClaw Medical Agent - Feasibility Test");
  console.log("  Synthetic Scenarios + Opus 4.5 Reasoning");
  console.log("===========================================\n");

  // Phase 1: Offline tests (no API calls)
  await runHL7ParsingTests();
  await runDeepLinkTests();

  // Phase 2: Live agent tests (requires ANTHROPIC_API_KEY)
  const config = getTestConfig();
  const agent = new MedicalAgent(config);
  const scenarios = generateScenarios();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`LIVE AGENT TESTS (${scenarios.length} scenarios)`);
  console.log(`Model: ${config.anthropic.model}`);
  console.log("=".repeat(60));

  const results: TestResult[] = [];

  for (const scenario of scenarios) {
    const result = await runScenario(agent, scenario);
    results.push(result);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  let totalInput = 0;
  let totalOutput = 0;

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.scenario} -> ${r.action} (review: ${r.requiresReview}, urgency: ${r.urgency})`);
    if (r.errors.length) {
      r.errors.forEach((e) => console.log(`       ERROR: ${e}`));
    }
    totalInput += r.tokenUsage.input;
    totalOutput += r.tokenUsage.output;
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\nResults: ${passed}/${results.length} passed`);
  console.log(`Total tokens: ${totalInput} input + ${totalOutput} output = ${totalInput + totalOutput} total`);

  // Safety check summary
  const criticalScenarios = results.filter((r) =>
    r.scenario.toLowerCase().includes("critical") || r.scenario.toLowerCase().includes("chest pain")
  );
  const criticalSafe = criticalScenarios.every((r) => r.requiresReview);
  console.log(`\nSafety check (critical scenarios escalated): ${criticalSafe ? "PASS" : "FAIL"}`);

  // Export audit log
  const auditLog = agent.getAuditLog();
  console.log(`\nAudit log entries: ${auditLog.length}`);
}

main().catch((error) => {
  console.error("Test harness error:", error);
  process.exit(1);
});
