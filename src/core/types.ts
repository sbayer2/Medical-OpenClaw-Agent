// Core type definitions for the OpenClaw Medical Agent

// --- HL7v2 / Clarity Connect types ---

export interface HL7Message {
  raw: string;
  messageType: string;       // e.g. "ORM^O01", "ORU^R01", "ADT^A08"
  segments: HL7Segment[];
  parsed: ParsedMedicalMessage;
}

export interface HL7Segment {
  id: string;                // e.g. "MSH", "PID", "OBR", "OBX"
  fields: string[];
}

export interface ParsedMedicalMessage {
  messageId: string;
  timestamp: string;
  messageType: MessageType;
  patient: PatientInfo;
  provider: ProviderInfo;
  content: MessageContent;
  epicDeepLink?: string;
}

export type MessageType =
  | "LAB_RESULT"
  | "LAB_ORDER_REQUEST"
  | "FOLLOW_UP_NEEDED"
  | "SCHEDULE_STUDY"
  | "CALL_OFFICE"
  | "MEDICATION_REFILL"
  | "REFERRAL_REQUEST"
  | "CRITICAL_ALERT"
  | "GENERAL_NOTIFICATION";

export interface PatientInfo {
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  sex: string;
  epicPatientId: string;
}

export interface ProviderInfo {
  npi: string;
  name: string;
  role: string;
}

export interface MessageContent {
  subject: string;
  body: string;
  urgency: "routine" | "urgent" | "stat" | "critical";
  labResults?: LabResult[];
  orderDetails?: OrderDetails;
  schedulingInfo?: SchedulingInfo;
}

export interface LabResult {
  testName: string;
  testCode: string;
  value: string;
  units: string;
  referenceRange: string;
  flag: "normal" | "abnormal" | "critical" | "";
  collectionTime: string;
}

export interface OrderDetails {
  orderId: string;
  orderType: string;
  orderDescription: string;
  status: string;
  priority: string;
}

export interface SchedulingInfo {
  studyType: string;
  preferredDate?: string;
  location?: string;
  instructions?: string;
}

// --- Agent decision types ---

export type AgentAction =
  | { type: "ORDER_LAB"; details: LabOrderAction }
  | { type: "SEND_FOLLOW_UP"; details: FollowUpAction }
  | { type: "SCHEDULE_STUDY"; details: ScheduleStudyAction }
  | { type: "CALL_OFFICE"; details: CallOfficeAction }
  | { type: "MEDICATION_REFILL"; details: MedicationRefillAction }
  | { type: "ACKNOWLEDGE"; details: AcknowledgeAction }
  | { type: "ESCALATE"; details: EscalateAction }
  | { type: "NO_ACTION"; reason: string };

export interface LabOrderAction {
  patientMrn: string;
  tests: Array<{ code: string; name: string; priority: string }>;
  clinicalIndication: string;
  scheduledDate?: string;
}

export interface FollowUpAction {
  patientMrn: string;
  followUpType: string;
  message: string;
  timeframe: string;
  recipient: string;
}

export interface ScheduleStudyAction {
  patientMrn: string;
  studyType: string;
  priority: string;
  clinicalIndication: string;
  preferredDate?: string;
  priorAuth?: boolean;
}

export interface CallOfficeAction {
  patientMrn: string;
  reason: string;
  callbackNumber: string;
  urgency: string;
}

export interface MedicationRefillAction {
  patientMrn: string;
  medication: string;
  dose: string;
  refillQuantity: number;
  pharmacy?: string;
}

export interface AcknowledgeAction {
  patientMrn: string;
  acknowledgmentNote: string;
}

export interface EscalateAction {
  patientMrn: string;
  reason: string;
  escalateTo: string;
  urgency: "routine" | "urgent" | "emergent";
}

// --- Slack message context ---

export interface SlackMessageContext {
  channelId: string;
  threadTs?: string;
  userId: string;
  text: string;
  parsedMedical?: ParsedMedicalMessage;
}

// --- Agent audit log ---

export interface AgentAuditEntry {
  timestamp: string;
  messageId: string;
  patientMrn: string;
  incomingMessage: string;
  agentReasoning: string;
  actionTaken: AgentAction;
  slackResponse: string;
  epicDeepLink?: string;
  model: string;
  tokenUsage?: { input: number; output: number };
}
