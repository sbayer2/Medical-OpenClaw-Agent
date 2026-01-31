// Synthetic Epic data generator - creates realistic HL7v2 messages and parsed JSON
// for testing the OpenClaw agent without a live Epic connection

import type { ParsedMedicalMessage, LabResult } from "../core/types.js";

// Synthetic patient roster - all fictional
const PATIENTS = [
  { mrn: "E7891234", firstName: "Maria", lastName: "Santos", dob: "1967-03-15", sex: "F", epicId: "PAT-78912" },
  { mrn: "E4567890", firstName: "James", lastName: "Thompson", dob: "1952-11-22", sex: "M", epicId: "PAT-45678" },
  { mrn: "E3456789", firstName: "Aisha", lastName: "Patel", dob: "1980-07-08", sex: "F", epicId: "PAT-34567" },
  { mrn: "E2345678", firstName: "Robert", lastName: "Chen", dob: "1945-01-30", sex: "M", epicId: "PAT-23456" },
  { mrn: "E6789012", firstName: "Linda", lastName: "Okafor", dob: "1973-09-12", sex: "F", epicId: "PAT-67890" },
];

const PROVIDERS = [
  { npi: "1234567890", name: "Dr. Sarah Kim", role: "PCP" },
  { npi: "9876543210", name: "Dr. Michael Ross", role: "Cardiologist" },
  { npi: "5678901234", name: "NP Jennifer Liu", role: "Nurse Practitioner" },
];

/**
 * Generate a raw HL7v2 message string (pipe-delimited).
 * These simulate what Clarity Connect sends before JSON conversion.
 */
export function generateHL7LabResult(scenario: "normal" | "abnormal" | "critical"): string {
  const patient = PATIENTS[0];
  const now = formatHL7Date(new Date());

  const baseMsg = [
    `MSH|^~\\&|EPIC|CLARITY|OPENCLAW|SLACK|${now}||ORU^R01|MSG-${Date.now()}|P|2.5.1`,
    `PID|||${patient.mrn}^^^EPIC||${patient.lastName}^${patient.firstName}||${patient.dob.replace(/-/g, "")}|${patient.sex}`,
    `ORC|RE|ORD-${Date.now()}||||||||||${PROVIDERS[0].npi}^${PROVIDERS[0].name.split(" ").pop()}^${PROVIDERS[0].name.split(" ").slice(0, -1).join(" ")}`,
    `OBR|1|ORD-${Date.now()}||BMP^Basic Metabolic Panel|||${now}`,
  ];

  switch (scenario) {
    case "normal":
      baseMsg.push(
        `OBX|1|NM|2345-7^Glucose||95|mg/dL|74-106|N|||F|||${now}`,
        `OBX|2|NM|2160-0^Creatinine||1.0|mg/dL|0.7-1.3|N|||F|||${now}`,
        `OBX|3|NM|2951-2^Sodium||140|mEq/L|136-145|N|||F|||${now}`,
        `OBX|4|NM|2823-3^Potassium||4.2|mEq/L|3.5-5.0|N|||F|||${now}`
      );
      break;

    case "abnormal":
      baseMsg.push(
        `OBX|1|NM|2345-7^Glucose||185|mg/dL|74-106|H|||F|||${now}`,
        `OBX|2|NM|2160-0^Creatinine||1.8|mg/dL|0.7-1.3|H|||F|||${now}`,
        `OBX|3|NM|2951-2^Sodium||140|mEq/L|136-145|N|||F|||${now}`,
        `OBX|4|NM|17856-6^HbA1c||8.2|%|4.0-5.6|H|||F|||${now}`
      );
      break;

    case "critical":
      baseMsg.push(
        `OBX|1|NM|2823-3^Potassium||6.8|mEq/L|3.5-5.0|HH|||F|||${now}`,
        `OBX|2|NM|2160-0^Creatinine||4.5|mg/dL|0.7-1.3|HH|||F|||${now}`,
        `OBX|3|NM|2345-7^Glucose||45|mg/dL|74-106|LL|||F|||${now}`,
        `OBX|4|NM|6298-4^INR||5.2||0.8-1.2|HH|||F|||${now}`
      );
      break;
  }

  return baseMsg.join("\r");
}

/**
 * Generate pre-parsed JSON messages (as if Clarity Connect already converted them).
 * These simulate the JSON payload that arrives in Slack.
 */
export function generateScenarios(): Array<{
  name: string;
  description: string;
  message: ParsedMedicalMessage;
}> {
  return [
    {
      name: "Normal CBC - Routine Acknowledgment",
      description: "All values within normal range. Agent should acknowledge and file.",
      message: {
        messageId: `MSG-NRM-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "LAB_RESULT",
        patient: PATIENTS[0],
        provider: PROVIDERS[0],
        content: {
          subject: "Lab Result: Complete Blood Count",
          body: "Routine CBC results - all within normal limits",
          urgency: "routine",
          labResults: [
            { testName: "WBC", testCode: "6690-2", value: "7.5", units: "K/uL", referenceRange: "4.5-11.0", flag: "normal", collectionTime: new Date().toISOString() },
            { testName: "Hemoglobin", testCode: "718-7", value: "14.2", units: "g/dL", referenceRange: "12.0-17.5", flag: "normal", collectionTime: new Date().toISOString() },
            { testName: "Platelets", testCode: "777-3", value: "250", units: "K/uL", referenceRange: "150-400", flag: "normal", collectionTime: new Date().toISOString() },
          ],
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-78912&source=openclaw",
      },
    },
    {
      name: "Abnormal A1c - Diabetes Follow-Up",
      description: "Elevated HbA1c in diabetic patient. Agent should flag for follow-up and suggest action.",
      message: {
        messageId: `MSG-ABN-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "LAB_RESULT",
        patient: PATIENTS[1],
        provider: PROVIDERS[0],
        content: {
          subject: "Lab Result: Hemoglobin A1c",
          body: "HbA1c elevated at 9.1%. Patient is on metformin 1000mg BID. Last A1c was 7.8% three months ago.",
          urgency: "urgent",
          labResults: [
            { testName: "HbA1c", testCode: "17856-6", value: "9.1", units: "%", referenceRange: "4.0-5.6", flag: "abnormal", collectionTime: new Date().toISOString() },
            { testName: "Glucose, Fasting", testCode: "2345-7", value: "210", units: "mg/dL", referenceRange: "74-106", flag: "abnormal", collectionTime: new Date().toISOString() },
          ],
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-45678&source=openclaw",
      },
    },
    {
      name: "Critical Potassium - Immediate Escalation",
      description: "Critically high potassium. Agent MUST escalate immediately and never act autonomously.",
      message: {
        messageId: `MSG-CRIT-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "LAB_RESULT",
        patient: PATIENTS[2],
        provider: PROVIDERS[2],
        content: {
          subject: "CRITICAL Lab Result: Basic Metabolic Panel",
          body: "CRITICAL VALUE: Potassium 7.1 mEq/L. Patient on lisinopril 20mg and spironolactone 25mg.",
          urgency: "critical",
          labResults: [
            { testName: "Potassium", testCode: "2823-3", value: "7.1", units: "mEq/L", referenceRange: "3.5-5.0", flag: "critical", collectionTime: new Date().toISOString() },
            { testName: "Creatinine", testCode: "2160-0", value: "3.2", units: "mg/dL", referenceRange: "0.7-1.3", flag: "critical", collectionTime: new Date().toISOString() },
            { testName: "BUN", testCode: "3094-0", value: "45", units: "mg/dL", referenceRange: "7-20", flag: "abnormal", collectionTime: new Date().toISOString() },
          ],
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-34567&source=openclaw",
      },
    },
    {
      name: "Scheduling Request - CT Abdomen",
      description: "Request to schedule CT abdomen for workup. Agent should process the scheduling.",
      message: {
        messageId: `MSG-SCH-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "SCHEDULE_STUDY",
        patient: PATIENTS[3],
        provider: PROVIDERS[1],
        content: {
          subject: "Scheduling Request: CT Abdomen/Pelvis with Contrast",
          body: "Please schedule CT abdomen/pelvis with contrast for abdominal pain workup. Patient has no contrast allergy. GFR > 60.",
          urgency: "urgent",
          schedulingInfo: {
            studyType: "CT Abdomen/Pelvis with Contrast",
            preferredDate: "within 1 week",
            location: "Main Campus Radiology",
            instructions: "NPO 4 hours prior. Ensure GFR > 30. No contrast allergy.",
          },
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-23456&source=openclaw",
      },
    },
    {
      name: "Medication Refill - Maintenance Statin",
      description: "Routine statin refill request. Agent should process autonomously.",
      message: {
        messageId: `MSG-RX-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "MEDICATION_REFILL",
        patient: PATIENTS[4],
        provider: PROVIDERS[0],
        content: {
          subject: "Medication Refill Request: Atorvastatin",
          body: "Patient requesting refill of atorvastatin 40mg daily. Last lipid panel 2 months ago showed LDL 95. Medication has been stable for 1 year.",
          urgency: "routine",
          orderDetails: {
            orderId: `ORD-RX-${Date.now()}`,
            orderType: "Medication Refill",
            orderDescription: "Atorvastatin 40mg PO daily",
            status: "Pending",
            priority: "routine",
          },
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-67890&source=openclaw",
      },
    },
    {
      name: "Follow-Up Needed - Post-Procedure Check",
      description: "2-week post-procedure follow-up needed. Agent should schedule appropriately.",
      message: {
        messageId: `MSG-FU-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "FOLLOW_UP_NEEDED",
        patient: PATIENTS[0],
        provider: PROVIDERS[1],
        content: {
          subject: "Follow-Up Required: Post-Cardiac Catheterization",
          body: "Patient underwent cardiac catheterization 2 days ago. Needs 2-week follow-up appointment. Access site healing well. No complications noted. Continue aspirin 81mg and clopidogrel 75mg.",
          urgency: "routine",
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-78912&source=openclaw",
      },
    },
    {
      name: "Office Call - Urgent Symptom Report",
      description: "Patient calling with new chest pain symptoms. Agent must triage urgently.",
      message: {
        messageId: `MSG-CALL-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "CALL_OFFICE",
        patient: PATIENTS[1],
        provider: PROVIDERS[0],
        content: {
          subject: "Office Call: New Onset Chest Pain",
          body: "Patient calling reporting new onset substernal chest pain x 2 hours, radiating to left arm, associated with diaphoresis. History of HTN, DM2, hyperlipidemia. No known CAD. Patient is at home.",
          urgency: "critical",
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-45678&source=openclaw",
      },
    },
    {
      name: "Lab Order Request - Annual Wellness",
      description: "Standing order for annual wellness labs. Agent should process per protocol.",
      message: {
        messageId: `MSG-ORD-${Date.now()}`,
        timestamp: new Date().toISOString(),
        messageType: "LAB_ORDER_REQUEST",
        patient: PATIENTS[4],
        provider: PROVIDERS[2],
        content: {
          subject: "Lab Order Request: Annual Wellness Panel",
          body: "Annual wellness visit labs needed: CBC, CMP, Lipid Panel, TSH, HbA1c. Patient due for routine screening per preventive care protocol.",
          urgency: "routine",
          orderDetails: {
            orderId: `ORD-WL-${Date.now()}`,
            orderType: "Lab Order",
            orderDescription: "Annual Wellness Panel (CBC, CMP, Lipid, TSH, HbA1c)",
            status: "Pending",
            priority: "routine",
          },
        },
        epicDeepLink: "epichaiku://open/patient?id=PAT-67890&source=openclaw",
      },
    },
  ];
}

function formatHL7Date(date: Date): string {
  return date.toISOString().replace(/[-T:\.Z]/g, "").slice(0, 14);
}
