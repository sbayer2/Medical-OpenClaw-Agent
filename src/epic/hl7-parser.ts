// HL7v2 pipe-delimited message parser
// Parses HL7v2 messages from Clarity Connect into structured JSON

import type {
  HL7Message,
  HL7Segment,
  ParsedMedicalMessage,
  MessageType,
  PatientInfo,
  ProviderInfo,
  LabResult,
} from "../core/types.js";

export class HL7Parser {
  /**
   * Parse a raw HL7v2 pipe-delimited message into a structured object.
   * HL7v2 uses | as field separator, ^ as component separator, ~ as repeat separator.
   *
   * Example MSH segment:
   * MSH|^~\&|EPIC|CLARITY|OPENCLAW|SLACK|20250131120000||ORU^R01|MSG001|P|2.5.1
   */
  parse(raw: string): HL7Message {
    const lines = raw.split(/[\r\n]+/).filter(Boolean);
    const segments = lines.map((line) => this.parseSegment(line));

    const msh = segments.find((s) => s.id === "MSH");
    const messageType = msh ? this.extractField(msh, 8) : "UNKNOWN";

    const parsed = this.buildParsedMessage(segments, messageType, raw);

    return {
      raw,
      messageType,
      segments,
      parsed,
    };
  }

  private parseSegment(line: string): HL7Segment {
    const fields = line.split("|");
    return {
      id: fields[0],
      fields,
    };
  }

  private extractField(segment: HL7Segment, index: number): string {
    return segment.fields[index] ?? "";
  }

  private extractComponent(field: string, index: number): string {
    const parts = field.split("^");
    return parts[index] ?? "";
  }

  private buildParsedMessage(
    segments: HL7Segment[],
    messageType: string,
    raw: string
  ): ParsedMedicalMessage {
    const msh = segments.find((s) => s.id === "MSH");
    const pid = segments.find((s) => s.id === "PID");
    const orc = segments.find((s) => s.id === "ORC");
    const obr = segments.find((s) => s.id === "OBR");
    const obxSegments = segments.filter((s) => s.id === "OBX");

    return {
      messageId: msh ? this.extractField(msh, 9) : `MSG-${Date.now()}`,
      timestamp: msh ? this.formatHL7Timestamp(this.extractField(msh, 6)) : new Date().toISOString(),
      messageType: this.classifyMessageType(messageType),
      patient: this.extractPatient(pid),
      provider: this.extractProvider(orc),
      content: {
        subject: this.buildSubject(messageType, obr),
        body: raw,
        urgency: this.determineUrgency(obr, obxSegments),
        labResults: this.extractLabResults(obxSegments),
        orderDetails: obr ? this.extractOrderDetails(orc, obr) : undefined,
      },
    };
  }

  private extractPatient(pid: HL7Segment | undefined): PatientInfo {
    if (!pid) {
      return {
        mrn: "UNKNOWN",
        firstName: "Unknown",
        lastName: "Patient",
        dob: "",
        sex: "",
        epicPatientId: "",
      };
    }

    const patientId = this.extractField(pid, 3);
    const patientName = this.extractField(pid, 5);

    return {
      mrn: this.extractComponent(patientId, 0),
      firstName: this.extractComponent(patientName, 1),
      lastName: this.extractComponent(patientName, 0),
      dob: this.formatHL7Timestamp(this.extractField(pid, 7)),
      sex: this.extractField(pid, 8),
      epicPatientId: this.extractComponent(patientId, 0),
    };
  }

  private extractProvider(orc: HL7Segment | undefined): ProviderInfo {
    if (!orc) {
      return { npi: "", name: "Unknown Provider", role: "Unknown" };
    }

    const orderingProvider = this.extractField(orc, 12);
    return {
      npi: this.extractComponent(orderingProvider, 0),
      name: `${this.extractComponent(orderingProvider, 2)} ${this.extractComponent(orderingProvider, 1)}`.trim() || "Unknown Provider",
      role: this.extractComponent(orderingProvider, 9) || "Ordering Provider",
    };
  }

  private extractLabResults(obxSegments: HL7Segment[]): LabResult[] {
    return obxSegments.map((obx) => {
      const testIdentifier = this.extractField(obx, 3);
      const value = this.extractField(obx, 5);
      const units = this.extractField(obx, 6);
      const refRange = this.extractField(obx, 7);
      const abnormalFlag = this.extractField(obx, 8);
      const collectionTime = this.extractField(obx, 14);

      return {
        testName: this.extractComponent(testIdentifier, 1) || this.extractComponent(testIdentifier, 0),
        testCode: this.extractComponent(testIdentifier, 0),
        value,
        units,
        referenceRange: refRange,
        flag: this.normalizeFlag(abnormalFlag),
        collectionTime: this.formatHL7Timestamp(collectionTime),
      };
    });
  }

  private extractOrderDetails(
    orc: HL7Segment | undefined,
    obr: HL7Segment
  ): { orderId: string; orderType: string; orderDescription: string; status: string; priority: string } {
    return {
      orderId: orc ? this.extractField(orc, 2) : "",
      orderType: this.extractComponent(this.extractField(obr, 4), 1),
      orderDescription: this.extractComponent(this.extractField(obr, 4), 1),
      status: orc ? this.extractField(orc, 5) : "",
      priority: obr ? this.extractField(obr, 27) : "routine",
    };
  }

  private classifyMessageType(hl7Type: string): MessageType {
    const typeMap: Record<string, MessageType> = {
      "ORU^R01": "LAB_RESULT",
      "ORM^O01": "LAB_ORDER_REQUEST",
      "SIU^S12": "SCHEDULE_STUDY",
      "ADT^A08": "GENERAL_NOTIFICATION",
      "RDE^O11": "MEDICATION_REFILL",
      "REF^I12": "REFERRAL_REQUEST",
    };
    return typeMap[hl7Type] ?? "GENERAL_NOTIFICATION";
  }

  private normalizeFlag(flag: string): "normal" | "abnormal" | "critical" | "" {
    const upper = flag.toUpperCase();
    if (upper === "H" || upper === "L" || upper === "A") return "abnormal";
    if (upper === "HH" || upper === "LL" || upper === "AA" || upper === "C") return "critical";
    if (upper === "N" || upper === "") return "normal";
    return "";
  }

  private determineUrgency(
    obr: HL7Segment | undefined,
    obxSegments: HL7Segment[]
  ): "routine" | "urgent" | "stat" | "critical" {
    // Check for critical flags in OBX segments
    for (const obx of obxSegments) {
      const flag = this.extractField(obx, 8).toUpperCase();
      if (flag === "HH" || flag === "LL" || flag === "AA" || flag === "C") {
        return "critical";
      }
    }

    // Check OBR priority
    if (obr) {
      const priority = this.extractField(obr, 27).toUpperCase();
      if (priority === "S" || priority === "STAT") return "stat";
      if (priority === "A" || priority === "ASAP") return "urgent";
    }

    return "routine";
  }

  private formatHL7Timestamp(ts: string): string {
    if (!ts || ts.length < 8) return ts;
    // HL7 format: YYYYMMDDHHMMSS
    const year = ts.slice(0, 4);
    const month = ts.slice(4, 6);
    const day = ts.slice(6, 8);
    const hour = ts.slice(8, 10) || "00";
    const minute = ts.slice(10, 12) || "00";
    const second = ts.slice(12, 14) || "00";
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }

  private buildSubject(messageType: string, obr: HL7Segment | undefined): string {
    const testName = obr
      ? this.extractComponent(this.extractField(obr, 4), 1)
      : "";
    switch (messageType) {
      case "ORU^R01": return `Lab Result: ${testName}`;
      case "ORM^O01": return `Lab Order Request: ${testName}`;
      case "SIU^S12": return `Scheduling Request: ${testName}`;
      case "RDE^O11": return `Medication Order: ${testName}`;
      case "REF^I12": return `Referral: ${testName}`;
      default: return `Clinical Message: ${messageType}`;
    }
  }
}
