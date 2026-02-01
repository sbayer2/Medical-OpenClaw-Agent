// Workato webhook adapter - receives HTTP POST from Workato recipes
// and feeds data into the OpenClaw agent pipeline.
//
// Workato users configure a recipe that:
//   1. Receives HL7v2 from Epic via On-Prem Agent (OPA)
//   2. Transforms the data (optional - Workato can send raw HL7v2 or JSON)
//   3. POSTs to this webhook endpoint
//
// This adapter also works with any HTTP-based integration platform
// (Mirth Connect, Rhapsody, Cloverleaf, custom middleware, etc.)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "../core/config.js";
import type { ParsedMedicalMessage } from "../core/types.js";
import type { MedicalAgent } from "../core/agent.js";
import { HL7Parser } from "../epic/hl7-parser.js";
import { FHIRParser, type FHIRBundle, type FHIRResource } from "../fhir/parser.js";
import { EpicDeepLinks } from "../epic/deep-links.js";

export interface WebhookResult {
  messageId: string;
  action: string;
  requiresReview: boolean;
  urgency: string;
  slackMessage: string;
}

export class WorkatoWebhook {
  private server: ReturnType<typeof createServer> | null = null;
  private agent: MedicalAgent;
  private hl7Parser: HL7Parser;
  private fhirParser: FHIRParser;
  private deepLinks: EpicDeepLinks;
  private webhookSecret: string;
  private port: number;
  private onResult?: (result: WebhookResult, message: ParsedMedicalMessage) => Promise<void>;

  constructor(
    config: Config,
    agent: MedicalAgent,
    onResult?: (result: WebhookResult, message: ParsedMedicalMessage) => Promise<void>
  ) {
    this.agent = agent;
    this.hl7Parser = new HL7Parser();
    this.fhirParser = new FHIRParser();
    this.deepLinks = new EpicDeepLinks(config.epic.haikuBaseUrl);
    this.webhookSecret = config.workato?.webhookSecret ?? "";
    this.port = config.workato?.webhookPort ?? 3100;
    this.onResult = onResult;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port, () => {
      console.log(`[Workato] Webhook listener started on port ${this.port}`);
      console.log(`[Workato] Endpoints:`);
      console.log(`[Workato]   POST /webhook/workato   — Workato recipe delivery`);
      console.log(`[Workato]   POST /webhook/fhir      — FHIR R4 Subscription notifications`);
      console.log(`[Workato]   POST /webhook/hl7       — Raw HL7v2 delivery`);
      console.log(`[Workato]   GET  /webhook/health    — Health check`);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log("[Workato] Webhook listener stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "";
    const method = req.method ?? "";

    // Health check
    if (url === "/webhook/health" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "openclaw-medical-agent", timestamp: new Date().toISOString() }));
      return;
    }

    // Only accept POST for webhook endpoints
    if (method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Authenticate
    if (this.webhookSecret) {
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.replace("Bearer ", "");
      if (token !== this.webhookSecret) {
        console.log("[Workato] Unauthorized webhook request rejected");
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // Read body
    const body = await this.readBody(req);

    try {
      let results: WebhookResult[];

      switch (url) {
        case "/webhook/workato":
          results = await this.handleWorkatoDelivery(body);
          break;
        case "/webhook/fhir":
          results = await this.handleFHIRDelivery(body);
          break;
        case "/webhook/hl7":
          results = await this.handleHL7Delivery(body);
          break;
        default:
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found", endpoints: ["/webhook/workato", "/webhook/fhir", "/webhook/hl7", "/webhook/health"] }));
          return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "processed", count: results.length, results }));
    } catch (error) {
      console.error("[Workato] Error processing webhook:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal processing error", message: String(error) }));
    }
  }

  /**
   * Handle Workato recipe delivery.
   * Workato can send data in multiple formats depending on how the recipe is configured:
   *   1. Pre-converted JSON matching our ParsedMedicalMessage schema
   *   2. FHIR R4 JSON (DiagnosticReport, Observation, etc.)
   *   3. Raw HL7v2 text wrapped in a JSON envelope
   */
  private async handleWorkatoDelivery(body: string): Promise<WebhookResult[]> {
    console.log("[Workato] Received Workato delivery");
    const data = JSON.parse(body);

    // Detect format
    if (data.resourceType) {
      // FHIR resource
      return this.handleFHIRDelivery(body);
    }

    if (data.hl7_raw || data.hl7Raw || data.raw_hl7) {
      // HL7v2 wrapped in JSON envelope (common Workato pattern)
      const hl7Text = data.hl7_raw ?? data.hl7Raw ?? data.raw_hl7;
      return this.handleHL7Delivery(hl7Text);
    }

    if (data.messageId && data.patient && data.content) {
      // Already matches ParsedMedicalMessage schema
      return this.processMessage(data as ParsedMedicalMessage);
    }

    // Try to interpret as a Workato-transformed payload
    // Workato's jq engine may produce a slightly different schema
    if (data.patient_mrn || data.patientMrn) {
      const normalized = this.normalizeWorkatoPayload(data);
      return this.processMessage(normalized);
    }

    throw new Error("Unrecognized payload format. Expected FHIR, HL7v2, or ParsedMedicalMessage JSON.");
  }

  /**
   * Handle FHIR R4 Subscription notification or direct FHIR resource delivery.
   * Used by Community Connect users who get data via FHIR Subscriptions.
   */
  private async handleFHIRDelivery(body: string): Promise<WebhookResult[]> {
    console.log("[Workato] Received FHIR delivery");
    const data = JSON.parse(body);
    const messages = this.fhirParser.parse(data);
    const results: WebhookResult[] = [];

    for (const msg of messages) {
      const r = await this.processMessage(msg);
      results.push(...r);
    }

    return results;
  }

  /**
   * Handle raw HL7v2 pipe-delimited delivery.
   * Can come from Mirth Connect, Rhapsody, Cloverleaf, or Workato OPA.
   */
  private async handleHL7Delivery(body: string): Promise<WebhookResult[]> {
    console.log("[Workato] Received HL7v2 delivery");
    const hl7 = this.hl7Parser.parse(body);
    return this.processMessage(hl7.parsed);
  }

  private async processMessage(message: ParsedMedicalMessage): Promise<WebhookResult[]> {
    // Add Epic deep link if not present
    if (!message.epicDeepLink && message.patient?.epicPatientId) {
      message.epicDeepLink = this.deepLinks.buildPatientChartLink(message.patient.epicPatientId);
    }

    const result = await this.agent.processMessage(message);

    const webhookResult: WebhookResult = {
      messageId: message.messageId,
      action: result.action.type,
      requiresReview: result.requiresPhysicianReview,
      urgency: result.urgency,
      slackMessage: result.slackMessage,
    };

    // Notify callback (e.g., post to Slack)
    if (this.onResult) {
      await this.onResult(webhookResult, message);
    }

    return [webhookResult];
  }

  /**
   * Normalize a Workato-transformed payload into ParsedMedicalMessage.
   * Workato recipes often use snake_case field names from their jq transforms.
   */
  private normalizeWorkatoPayload(data: Record<string, unknown>): ParsedMedicalMessage {
    return {
      messageId: String(data.message_id ?? data.messageId ?? `WKT-${Date.now()}`),
      timestamp: String(data.timestamp ?? new Date().toISOString()),
      messageType: this.normalizeMessageType(String(data.message_type ?? data.messageType ?? "GENERAL_NOTIFICATION")),
      patient: {
        mrn: String(data.patient_mrn ?? data.patientMrn ?? "UNKNOWN"),
        firstName: String(data.patient_first_name ?? data.patientFirstName ?? "Unknown"),
        lastName: String(data.patient_last_name ?? data.patientLastName ?? "Patient"),
        dob: String(data.patient_dob ?? data.patientDob ?? ""),
        sex: String(data.patient_sex ?? data.patientSex ?? ""),
        epicPatientId: String(data.epic_patient_id ?? data.epicPatientId ?? data.patient_mrn ?? data.patientMrn ?? ""),
      },
      provider: {
        npi: String(data.provider_npi ?? data.providerNpi ?? ""),
        name: String(data.provider_name ?? data.providerName ?? "Unknown Provider"),
        role: String(data.provider_role ?? data.providerRole ?? "Unknown"),
      },
      content: {
        subject: String(data.subject ?? "Clinical Message"),
        body: String(data.body ?? data.message ?? ""),
        urgency: this.normalizeUrgency(String(data.urgency ?? data.priority ?? "routine")),
      },
    };
  }

  private normalizeMessageType(type: string): ParsedMedicalMessage["messageType"] {
    const map: Record<string, ParsedMedicalMessage["messageType"]> = {
      "lab_result": "LAB_RESULT", "LAB_RESULT": "LAB_RESULT", "ORU": "LAB_RESULT",
      "lab_order": "LAB_ORDER_REQUEST", "LAB_ORDER_REQUEST": "LAB_ORDER_REQUEST", "ORM": "LAB_ORDER_REQUEST",
      "follow_up": "FOLLOW_UP_NEEDED", "FOLLOW_UP_NEEDED": "FOLLOW_UP_NEEDED",
      "schedule": "SCHEDULE_STUDY", "SCHEDULE_STUDY": "SCHEDULE_STUDY", "SIU": "SCHEDULE_STUDY",
      "call": "CALL_OFFICE", "CALL_OFFICE": "CALL_OFFICE",
      "refill": "MEDICATION_REFILL", "MEDICATION_REFILL": "MEDICATION_REFILL", "RDE": "MEDICATION_REFILL",
      "referral": "REFERRAL_REQUEST", "REFERRAL_REQUEST": "REFERRAL_REQUEST",
      "critical": "CRITICAL_ALERT", "CRITICAL_ALERT": "CRITICAL_ALERT",
    };
    return map[type] ?? "GENERAL_NOTIFICATION";
  }

  private normalizeUrgency(urgency: string): "routine" | "urgent" | "stat" | "critical" {
    const lower = urgency.toLowerCase();
    if (lower === "critical" || lower === "emergent") return "critical";
    if (lower === "stat") return "stat";
    if (lower === "urgent" || lower === "asap") return "urgent";
    return "routine";
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  }
}
