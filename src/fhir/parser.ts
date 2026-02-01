// FHIR R4 resource parser for Epic Community Connect users
// Converts FHIR R4 JSON resources (DiagnosticReport, Observation, etc.)
// into the same ParsedMedicalMessage format used by the agent pipeline.
//
// Community Connect affiliates typically receive data via FHIR R4 APIs
// (Subscriptions or polling) rather than HL7v2 via Bridges, because
// they don't control the host's interface engine.

import type {
  ParsedMedicalMessage,
  MessageType,
  PatientInfo,
  ProviderInfo,
  LabResult,
  OrderDetails,
  SchedulingInfo,
} from "../core/types.js";

// --- FHIR R4 resource type definitions (subset relevant to our use case) ---

export interface FHIRBundle {
  resourceType: "Bundle";
  type: string;
  entry?: Array<{ resource: FHIRResource }>;
}

export type FHIRResource =
  | FHIRDiagnosticReport
  | FHIRObservation
  | FHIRServiceRequest
  | FHIRMedicationRequest
  | FHIRCommunication
  | FHIRPatient
  | FHIREncounter
  | Record<string, unknown>;

export interface FHIRDiagnosticReport {
  resourceType: "DiagnosticReport";
  id?: string;
  status: string;
  category?: Array<{ coding?: Array<{ code?: string; display?: string }> }>;
  code: { coding?: Array<{ code?: string; display?: string; system?: string }>; text?: string };
  subject?: { reference?: string; display?: string };
  effectiveDateTime?: string;
  issued?: string;
  performer?: Array<{ reference?: string; display?: string }>;
  result?: Array<{ reference?: string; display?: string }>;
  conclusion?: string;
  presentedForm?: Array<{ contentType?: string; data?: string }>;
}

export interface FHIRObservation {
  resourceType: "Observation";
  id?: string;
  status: string;
  category?: Array<{ coding?: Array<{ code?: string; display?: string }> }>;
  code: { coding?: Array<{ code?: string; display?: string; system?: string }>; text?: string };
  subject?: { reference?: string; display?: string };
  effectiveDateTime?: string;
  valueQuantity?: { value?: number; unit?: string; system?: string; code?: string };
  valueString?: string;
  referenceRange?: Array<{ low?: { value?: number; unit?: string }; high?: { value?: number; unit?: string }; text?: string }>;
  interpretation?: Array<{ coding?: Array<{ code?: string; display?: string }> }>;
}

export interface FHIRServiceRequest {
  resourceType: "ServiceRequest";
  id?: string;
  status: string;
  intent: string;
  priority?: string;
  category?: Array<{ coding?: Array<{ code?: string; display?: string }> }>;
  code?: { coding?: Array<{ code?: string; display?: string }>; text?: string };
  subject?: { reference?: string; display?: string };
  requester?: { reference?: string; display?: string };
  occurrenceDateTime?: string;
  reasonCode?: Array<{ coding?: Array<{ code?: string; display?: string }>; text?: string }>;
  note?: Array<{ text?: string }>;
}

export interface FHIRMedicationRequest {
  resourceType: "MedicationRequest";
  id?: string;
  status: string;
  intent: string;
  priority?: string;
  medicationCodeableConcept?: { coding?: Array<{ code?: string; display?: string }>; text?: string };
  medicationReference?: { reference?: string; display?: string };
  subject?: { reference?: string; display?: string };
  requester?: { reference?: string; display?: string };
  dosageInstruction?: Array<{ text?: string; doseAndRate?: Array<{ doseQuantity?: { value?: number; unit?: string } }> }>;
  dispenseRequest?: { numberOfRepeatsAllowed?: number; quantity?: { value?: number; unit?: string } };
}

export interface FHIRCommunication {
  resourceType: "Communication";
  id?: string;
  status: string;
  category?: Array<{ coding?: Array<{ code?: string; display?: string }> }>;
  priority?: string;
  subject?: { reference?: string; display?: string };
  sender?: { reference?: string; display?: string };
  payload?: Array<{ contentString?: string }>;
  sent?: string;
}

export interface FHIRPatient {
  resourceType: "Patient";
  id?: string;
  identifier?: Array<{ type?: { coding?: Array<{ code?: string }> }; value?: string; system?: string }>;
  name?: Array<{ family?: string; given?: string[]; text?: string }>;
  gender?: string;
  birthDate?: string;
}

export interface FHIREncounter {
  resourceType: "Encounter";
  id?: string;
  status: string;
  class?: { code?: string; display?: string };
  type?: Array<{ coding?: Array<{ code?: string; display?: string }>; text?: string }>;
  subject?: { reference?: string; display?: string };
  participant?: Array<{ individual?: { reference?: string; display?: string } }>;
  period?: { start?: string; end?: string };
}

// --- Parser ---

export class FHIRParser {
  /**
   * Parse a FHIR R4 resource or Bundle into a ParsedMedicalMessage.
   * Accepts either a single resource or a Bundle containing multiple resources.
   */
  parse(input: string | FHIRResource | FHIRBundle): ParsedMedicalMessage[] {
    const data = typeof input === "string" ? JSON.parse(input) : input;

    if (data.resourceType === "Bundle") {
      return this.parseBundle(data as FHIRBundle);
    }

    const parsed = this.parseSingleResource(data as FHIRResource);
    return parsed ? [parsed] : [];
  }

  private parseBundle(bundle: FHIRBundle): ParsedMedicalMessage[] {
    if (!bundle.entry?.length) return [];
    const results: ParsedMedicalMessage[] = [];
    for (const entry of bundle.entry) {
      const parsed = this.parseSingleResource(entry.resource);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  private parseSingleResource(resource: FHIRResource): ParsedMedicalMessage | null {
    switch (resource.resourceType) {
      case "DiagnosticReport":
        return this.parseDiagnosticReport(resource);
      case "Observation":
        return this.parseObservation(resource);
      case "ServiceRequest":
        return this.parseServiceRequest(resource);
      case "MedicationRequest":
        return this.parseMedicationRequest(resource);
      case "Communication":
        return this.parseCommunication(resource);
      default:
        return null;
    }
  }

  private parseDiagnosticReport(report: FHIRDiagnosticReport): ParsedMedicalMessage {
    const testName = report.code?.text ?? report.code?.coding?.[0]?.display ?? "Unknown Test";
    const labResults: LabResult[] = (report.result ?? []).map((ref) => ({
      testName: ref.display ?? "Unknown",
      testCode: "",
      value: "",
      units: "",
      referenceRange: "",
      flag: "" as const,
      collectionTime: report.effectiveDateTime ?? "",
    }));

    return {
      messageId: report.id ?? `FHIR-DR-${Date.now()}`,
      timestamp: report.issued ?? report.effectiveDateTime ?? new Date().toISOString(),
      messageType: "LAB_RESULT",
      patient: this.extractPatientFromReference(report.subject),
      provider: this.extractProviderFromReference(report.performer?.[0]),
      content: {
        subject: `Lab Result: ${testName}`,
        body: report.conclusion ?? `FHIR DiagnosticReport for ${testName}`,
        urgency: "routine",
        labResults: labResults.length ? labResults : undefined,
      },
    };
  }

  private parseObservation(obs: FHIRObservation): ParsedMedicalMessage {
    const testName = obs.code?.text ?? obs.code?.coding?.[0]?.display ?? "Unknown Test";
    const testCode = obs.code?.coding?.[0]?.code ?? "";
    const value = obs.valueQuantity?.value?.toString() ?? obs.valueString ?? "";
    const units = obs.valueQuantity?.unit ?? "";
    const refRange = this.formatReferenceRange(obs.referenceRange?.[0]);
    const flag = this.interpretFlag(obs.interpretation?.[0]);

    const labResult: LabResult = {
      testName,
      testCode,
      value,
      units,
      referenceRange: refRange,
      flag,
      collectionTime: obs.effectiveDateTime ?? "",
    };

    return {
      messageId: obs.id ?? `FHIR-OBS-${Date.now()}`,
      timestamp: obs.effectiveDateTime ?? new Date().toISOString(),
      messageType: "LAB_RESULT",
      patient: this.extractPatientFromReference(obs.subject),
      provider: { npi: "", name: "Unknown Provider", role: "Unknown" },
      content: {
        subject: `Lab Result: ${testName}`,
        body: `${testName}: ${value} ${units} (ref: ${refRange}) [${flag || "normal"}]`,
        urgency: flag === "critical" ? "critical" : flag === "abnormal" ? "urgent" : "routine",
        labResults: [labResult],
      },
    };
  }

  private parseServiceRequest(req: FHIRServiceRequest): ParsedMedicalMessage {
    const studyName = req.code?.text ?? req.code?.coding?.[0]?.display ?? "Unknown Study";
    const isLab = req.category?.some((c) =>
      c.coding?.some((cd) => cd.code === "108252007" || cd.display?.toLowerCase().includes("lab"))
    );

    const messageType: MessageType = isLab ? "LAB_ORDER_REQUEST" : "SCHEDULE_STUDY";
    const schedulingInfo: SchedulingInfo | undefined = !isLab ? {
      studyType: studyName,
      preferredDate: req.occurrenceDateTime,
      instructions: req.note?.map((n) => n.text).join("; "),
    } : undefined;
    const orderDetails: OrderDetails | undefined = isLab ? {
      orderId: req.id ?? "",
      orderType: "Lab Order",
      orderDescription: studyName,
      status: req.status,
      priority: req.priority ?? "routine",
    } : undefined;

    return {
      messageId: req.id ?? `FHIR-SR-${Date.now()}`,
      timestamp: new Date().toISOString(),
      messageType,
      patient: this.extractPatientFromReference(req.subject),
      provider: this.extractProviderFromReference(req.requester),
      content: {
        subject: `${isLab ? "Lab Order" : "Scheduling"} Request: ${studyName}`,
        body: req.reasonCode?.map((r) => r.text ?? r.coding?.[0]?.display).join("; ") ?? studyName,
        urgency: this.mapPriority(req.priority),
        schedulingInfo,
        orderDetails,
      },
    };
  }

  private parseMedicationRequest(req: FHIRMedicationRequest): ParsedMedicalMessage {
    const medName = req.medicationCodeableConcept?.text
      ?? req.medicationCodeableConcept?.coding?.[0]?.display
      ?? req.medicationReference?.display
      ?? "Unknown Medication";
    const dose = req.dosageInstruction?.[0]?.text ?? "";

    return {
      messageId: req.id ?? `FHIR-MR-${Date.now()}`,
      timestamp: new Date().toISOString(),
      messageType: "MEDICATION_REFILL",
      patient: this.extractPatientFromReference(req.subject),
      provider: this.extractProviderFromReference(req.requester),
      content: {
        subject: `Medication Request: ${medName}`,
        body: `${medName} - ${dose}`,
        urgency: this.mapPriority(req.priority),
        orderDetails: {
          orderId: req.id ?? "",
          orderType: "Medication",
          orderDescription: `${medName} ${dose}`,
          status: req.status,
          priority: req.priority ?? "routine",
        },
      },
    };
  }

  private parseCommunication(comm: FHIRCommunication): ParsedMedicalMessage {
    const body = comm.payload?.map((p) => p.contentString).filter(Boolean).join("\n") ?? "";
    const category = comm.category?.[0]?.coding?.[0]?.display ?? "Clinical Message";
    const isFollowUp = category.toLowerCase().includes("follow") || body.toLowerCase().includes("follow-up");
    const isCall = category.toLowerCase().includes("call") || body.toLowerCase().includes("call");

    let messageType: MessageType = "GENERAL_NOTIFICATION";
    if (isFollowUp) messageType = "FOLLOW_UP_NEEDED";
    if (isCall) messageType = "CALL_OFFICE";

    return {
      messageId: comm.id ?? `FHIR-COMM-${Date.now()}`,
      timestamp: comm.sent ?? new Date().toISOString(),
      messageType,
      patient: this.extractPatientFromReference(comm.subject),
      provider: this.extractProviderFromReference(comm.sender),
      content: {
        subject: `${category}`,
        body,
        urgency: this.mapPriority(comm.priority),
      },
    };
  }

  // --- Helpers ---

  private extractPatientFromReference(ref?: { reference?: string; display?: string }): PatientInfo {
    if (!ref) return { mrn: "UNKNOWN", firstName: "Unknown", lastName: "Patient", dob: "", sex: "", epicPatientId: "" };
    const patientId = ref.reference?.replace("Patient/", "") ?? "";
    const parts = (ref.display ?? "Unknown Patient").split(/[\s,]+/);
    return {
      mrn: patientId,
      firstName: parts[1] ?? parts[0] ?? "Unknown",
      lastName: parts[0] ?? "Patient",
      dob: "",
      sex: "",
      epicPatientId: patientId,
    };
  }

  private extractProviderFromReference(ref?: { reference?: string; display?: string }): ProviderInfo {
    if (!ref) return { npi: "", name: "Unknown Provider", role: "Unknown" };
    return {
      npi: ref.reference?.replace("Practitioner/", "") ?? "",
      name: ref.display ?? "Unknown Provider",
      role: "Ordering Provider",
    };
  }

  private formatReferenceRange(range?: { low?: { value?: number; unit?: string }; high?: { value?: number; unit?: string }; text?: string }): string {
    if (!range) return "";
    if (range.text) return range.text;
    const low = range.low?.value ?? "";
    const high = range.high?.value ?? "";
    const unit = range.low?.unit ?? range.high?.unit ?? "";
    if (low !== "" && high !== "") return `${low}-${high} ${unit}`.trim();
    if (low !== "") return `>= ${low} ${unit}`.trim();
    if (high !== "") return `<= ${high} ${unit}`.trim();
    return "";
  }

  private interpretFlag(interp?: { coding?: Array<{ code?: string; display?: string }> }): "normal" | "abnormal" | "critical" | "" {
    if (!interp?.coding?.length) return "";
    const code = interp.coding[0].code?.toUpperCase() ?? "";
    if (code === "N" || code === "NORMAL") return "normal";
    if (code === "H" || code === "L" || code === "A" || code === "HU" || code === "LU" || code === "ABNORMAL") return "abnormal";
    if (code === "HH" || code === "LL" || code === "AA" || code === "CRITICAL" || code === "CC") return "critical";
    return "";
  }

  private mapPriority(priority?: string): "routine" | "urgent" | "stat" | "critical" {
    switch (priority?.toLowerCase()) {
      case "stat": return "stat";
      case "asap":
      case "urgent": return "urgent";
      default: return "routine";
    }
  }
}
