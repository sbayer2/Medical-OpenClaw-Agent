// Core medical reasoning agent powered by Anthropic Opus 4.5

import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";
import type {
  ParsedMedicalMessage,
  AgentAction,
  AgentAuditEntry,
} from "./types.js";

const SYSTEM_PROMPT = `You are OpenClaw, an AI medical assistant acting on behalf of a physician. You operate within a Slack workspace connected to Epic Haiku via Clarity Connect.

YOUR ROLE:
- You receive clinical messages from Epic (lab results, follow-up requests, scheduling needs, office call requests) that have been converted from HL7v2 to JSON.
- You analyze each message and determine the appropriate clinical action.
- You act autonomously for routine, well-defined tasks (acknowledging normal labs, scheduling routine follow-ups, etc.).
- You escalate to the physician for anything requiring clinical judgment beyond your scope.

CLINICAL DECISION RULES:
1. NORMAL LAB RESULTS: Acknowledge and file. Notify patient if configured.
2. ABNORMAL (non-critical) LAB RESULTS: Flag for physician review, suggest follow-up.
3. CRITICAL LAB RESULTS: ALWAYS escalate immediately. Never act autonomously on critical values.
4. LAB ORDER REQUESTS: Process routine standing orders. Flag non-routine for approval.
5. FOLLOW-UP NOTIFICATIONS: Schedule per standard care protocols.
6. STUDY SCHEDULING: Process routine imaging/studies. Flag those needing prior auth.
7. OFFICE CALLS: Triage by urgency. Route urgent to physician immediately.
8. MEDICATION REFILLS: Process maintenance medication refills per protocol. Flag controlled substances.

SAFETY CONSTRAINTS:
- NEVER prescribe new medications autonomously.
- NEVER change medication dosages without physician approval.
- NEVER dismiss critical lab values.
- NEVER act on ambiguous orders without clarification.
- ALWAYS include patient MRN and Epic deep link in responses.
- ALWAYS log reasoning for audit trail.

RESPONSE FORMAT:
Return a JSON object with these fields:
{
  "reasoning": "Your clinical reasoning for the decision",
  "action": { ... the AgentAction object ... },
  "slackMessage": "The human-readable message to post in Slack",
  "requiresPhysicianReview": true/false,
  "urgency": "routine|urgent|stat|critical"
}`;

export class MedicalAgent {
  private client: Anthropic;
  private model: string;
  private physicianName: string;
  private auditLog: AgentAuditEntry[] = [];

  constructor(config: Config) {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
    this.model = config.anthropic.model;
    this.physicianName = config.agent.physicianName;
  }

  async processMessage(
    message: ParsedMedicalMessage
  ): Promise<{
    reasoning: string;
    action: AgentAction;
    slackMessage: string;
    requiresPhysicianReview: boolean;
    urgency: string;
    auditEntry: AgentAuditEntry;
  }> {
    const userPrompt = this.buildPrompt(message);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";

    const parsed = this.parseAgentResponse(responseText);

    const auditEntry: AgentAuditEntry = {
      timestamp: new Date().toISOString(),
      messageId: message.messageId,
      patientMrn: message.patient.mrn,
      incomingMessage: JSON.stringify(message),
      agentReasoning: parsed.reasoning,
      actionTaken: parsed.action,
      slackResponse: parsed.slackMessage,
      epicDeepLink: message.epicDeepLink,
      model: this.model,
      tokenUsage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };

    this.auditLog.push(auditEntry);

    return { ...parsed, auditEntry };
  }

  private buildPrompt(message: ParsedMedicalMessage): string {
    return `INCOMING CLINICAL MESSAGE:

Message Type: ${message.messageType}
Timestamp: ${message.timestamp}
Message ID: ${message.messageId}

PATIENT:
  MRN: ${message.patient.mrn}
  Name: ${message.patient.lastName}, ${message.patient.firstName}
  DOB: ${message.patient.dob}
  Sex: ${message.patient.sex}
  Epic Patient ID: ${message.patient.epicPatientId}

ORDERING/REFERRING PROVIDER:
  Name: ${message.provider.name}
  NPI: ${message.provider.npi}
  Role: ${message.provider.role}

CONTENT:
  Subject: ${message.content.subject}
  Body: ${message.content.body}
  Urgency: ${message.content.urgency}

${this.formatLabResults(message.content.labResults)}
${this.formatOrderDetails(message.content.orderDetails)}
${this.formatSchedulingInfo(message.content.schedulingInfo)}

EPIC DEEP LINK: ${message.epicDeepLink ?? "Not available"}

Physician on record: ${this.physicianName}

Analyze this message and determine the appropriate action. Return your response as a JSON object.`;
  }

  private formatLabResults(
    results: ParsedMedicalMessage["content"]["labResults"]
  ): string {
    if (!results?.length) return "";
    return `LAB RESULTS:
${results
  .map(
    (r) =>
      `  - ${r.testName} (${r.testCode}): ${r.value} ${r.units} [Ref: ${r.referenceRange}] Flag: ${r.flag} | Collected: ${r.collectionTime}`
  )
  .join("\n")}`;
  }

  private formatOrderDetails(
    order: ParsedMedicalMessage["content"]["orderDetails"]
  ): string {
    if (!order) return "";
    return `ORDER DETAILS:
  Order ID: ${order.orderId}
  Type: ${order.orderType}
  Description: ${order.orderDescription}
  Status: ${order.status}
  Priority: ${order.priority}`;
  }

  private formatSchedulingInfo(
    info: ParsedMedicalMessage["content"]["schedulingInfo"]
  ): string {
    if (!info) return "";
    return `SCHEDULING INFO:
  Study Type: ${info.studyType}
  Preferred Date: ${info.preferredDate ?? "Not specified"}
  Location: ${info.location ?? "Not specified"}
  Instructions: ${info.instructions ?? "None"}`;
  }

  private parseAgentResponse(text: string): {
    reasoning: string;
    action: AgentAction;
    slackMessage: string;
    requiresPhysicianReview: boolean;
    urgency: string;
  } {
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reasoning: parsed.reasoning ?? "No reasoning provided",
        action: parsed.action ?? { type: "NO_ACTION", reason: "Parse error" },
        slackMessage: parsed.slackMessage ?? "Unable to process message.",
        requiresPhysicianReview: parsed.requiresPhysicianReview ?? true,
        urgency: parsed.urgency ?? "routine",
      };
    } catch {
      return {
        reasoning: `Failed to parse agent response: ${text.slice(0, 200)}`,
        action: { type: "ESCALATE", details: { patientMrn: "unknown", reason: "Agent response parse failure", escalateTo: "physician", urgency: "urgent" } },
        slackMessage: `[OpenClaw] Unable to process this message automatically. Escalating to ${this.physicianName} for review.`,
        requiresPhysicianReview: true,
        urgency: "urgent",
      };
    }
  }

  getAuditLog(): AgentAuditEntry[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }
}
