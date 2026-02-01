// Quick test runner - runs offline tests only (no API key needed)

import { HL7Parser } from "../epic/hl7-parser.js";
import { EpicDeepLinks } from "../epic/deep-links.js";
import { FHIRParser } from "../fhir/parser.js";
import { generateHL7LabResult, generateScenarios } from "./synthetic-data.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function testHL7Parser(): void {
  console.log("\n--- HL7v2 Parser Tests ---\n");
  const parser = new HL7Parser();

  // Test normal labs
  const normalHL7 = generateHL7LabResult("normal");
  const normalParsed = parser.parse(normalHL7);
  assert(normalParsed.messageType === "ORU^R01", "Normal: correct message type");
  assert(normalParsed.parsed.patient.mrn === "E7891234", "Normal: correct MRN");
  assert(normalParsed.parsed.patient.firstName === "Maria", "Normal: correct first name");
  assert(normalParsed.parsed.patient.lastName === "Santos", "Normal: correct last name");
  assert(normalParsed.parsed.content.labResults?.length === 4, "Normal: 4 lab results");
  assert(normalParsed.parsed.content.urgency === "routine", "Normal: routine urgency");
  assert(
    normalParsed.parsed.content.labResults?.every((r) => r.flag === "normal") ?? false,
    "Normal: all flags normal"
  );

  // Test abnormal labs
  const abnormalHL7 = generateHL7LabResult("abnormal");
  const abnormalParsed = parser.parse(abnormalHL7);
  assert(abnormalParsed.parsed.content.labResults?.length === 4, "Abnormal: 4 lab results");
  assert(
    abnormalParsed.parsed.content.labResults?.some((r) => r.flag === "abnormal") ?? false,
    "Abnormal: has abnormal flags"
  );

  // Test critical labs
  const criticalHL7 = generateHL7LabResult("critical");
  const criticalParsed = parser.parse(criticalHL7);
  assert(criticalParsed.parsed.content.urgency === "critical", "Critical: critical urgency detected");
  assert(
    criticalParsed.parsed.content.labResults?.some((r) => r.flag === "critical") ?? false,
    "Critical: has critical flags"
  );
}

function testEpicDeepLinks(): void {
  console.log("\n--- Epic Deep Link Tests ---\n");
  const links = new EpicDeepLinks("https://test.epic.com");

  const chartLink = links.buildPatientChartLink("PAT-12345");
  assert(chartLink.startsWith("epichaiku://"), "Chart link uses epichaiku:// scheme");
  assert(chartLink.includes("PAT-12345"), "Chart link contains patient ID");

  const webLink = links.buildWebChartLink("PAT-12345");
  assert(webLink.includes("test.epic.com"), "Web link contains base URL");
  assert(webLink.includes("PAT-12345"), "Web link contains patient ID");

  const labLink = links.buildLabResultLink("PAT-12345", "ORD-999");
  assert(labLink.includes("view=results"), "Lab link contains results view");
  assert(labLink.includes("ORD-999"), "Lab link contains order ID");
}

function testFHIRParser(): void {
  console.log("\n--- FHIR R4 Parser Tests (Community Connect) ---\n");
  const parser = new FHIRParser();

  // Test DiagnosticReport
  const diagReport = {
    resourceType: "DiagnosticReport" as const,
    id: "DR-12345",
    status: "final",
    code: { coding: [{ code: "58410-2", display: "Complete Blood Count", system: "http://loinc.org" }], text: "CBC" },
    subject: { reference: "Patient/PAT-99999", display: "Smith, John" },
    effectiveDateTime: "2026-01-31T10:00:00Z",
    issued: "2026-01-31T12:00:00Z",
    performer: [{ reference: "Practitioner/PROV-111", display: "Dr. Jane Doe" }],
    result: [
      { reference: "Observation/OBS-1", display: "WBC" },
      { reference: "Observation/OBS-2", display: "Hemoglobin" },
    ],
    conclusion: "All values within normal limits.",
  };
  const drResults = parser.parse(diagReport);
  assert(drResults.length === 1, "DiagnosticReport: parsed 1 message");
  assert(drResults[0].messageType === "LAB_RESULT", "DiagnosticReport: correct message type");
  assert(drResults[0].patient.mrn === "PAT-99999", "DiagnosticReport: correct patient ID");
  assert(drResults[0].provider.name === "Dr. Jane Doe", "DiagnosticReport: correct provider");
  assert(drResults[0].content.subject.includes("CBC"), "DiagnosticReport: subject contains test name");

  // Test Observation (critical potassium)
  const critObs = {
    resourceType: "Observation" as const,
    id: "OBS-CRIT-1",
    status: "final",
    code: { coding: [{ code: "2823-3", display: "Potassium", system: "http://loinc.org" }], text: "Potassium" },
    subject: { reference: "Patient/PAT-88888", display: "Doe, Jane" },
    effectiveDateTime: "2026-01-31T08:00:00Z",
    valueQuantity: { value: 6.9, unit: "mEq/L" },
    referenceRange: [{ low: { value: 3.5, unit: "mEq/L" }, high: { value: 5.0, unit: "mEq/L" } }],
    interpretation: [{ coding: [{ code: "HH", display: "Critical high" }] }],
  };
  const obsResults = parser.parse(critObs);
  assert(obsResults.length === 1, "Observation: parsed 1 message");
  assert(obsResults[0].messageType === "LAB_RESULT", "Observation: correct message type");
  assert(obsResults[0].content.labResults?.[0]?.value === "6.9", "Observation: correct value");
  assert(obsResults[0].content.labResults?.[0]?.flag === "critical", "Observation: critical flag detected");
  assert(obsResults[0].content.urgency === "critical", "Observation: urgency is critical");
  assert(obsResults[0].content.labResults?.[0]?.referenceRange === "3.5-5 mEq/L", "Observation: reference range formatted");

  // Test ServiceRequest (scheduling)
  const schedReq = {
    resourceType: "ServiceRequest" as const,
    id: "SR-55555",
    status: "active",
    intent: "order",
    priority: "urgent",
    code: { text: "CT Abdomen with Contrast" },
    subject: { reference: "Patient/PAT-77777", display: "Chen, Robert" },
    requester: { reference: "Practitioner/PROV-222", display: "Dr. Michael Ross" },
    reasonCode: [{ text: "Abdominal pain evaluation" }],
  };
  const srResults = parser.parse(schedReq);
  assert(srResults.length === 1, "ServiceRequest: parsed 1 message");
  assert(srResults[0].messageType === "SCHEDULE_STUDY", "ServiceRequest: correct message type");
  assert(srResults[0].content.urgency === "urgent", "ServiceRequest: urgent priority");
  assert(srResults[0].provider.name === "Dr. Michael Ross", "ServiceRequest: correct requester");

  // Test MedicationRequest
  const medReq = {
    resourceType: "MedicationRequest" as const,
    id: "MR-33333",
    status: "active",
    intent: "order",
    medicationCodeableConcept: { text: "Atorvastatin 40mg" },
    subject: { reference: "Patient/PAT-66666", display: "Okafor, Linda" },
    requester: { reference: "Practitioner/PROV-333", display: "Dr. Sarah Kim" },
    dosageInstruction: [{ text: "Take 1 tablet by mouth daily at bedtime" }],
  };
  const mrResults = parser.parse(medReq);
  assert(mrResults.length === 1, "MedicationRequest: parsed 1 message");
  assert(mrResults[0].messageType === "MEDICATION_REFILL", "MedicationRequest: correct message type");
  assert(mrResults[0].content.subject.includes("Atorvastatin"), "MedicationRequest: subject has medication name");

  // Test Communication (follow-up detection)
  const comm = {
    resourceType: "Communication" as const,
    id: "COMM-44444",
    status: "completed",
    category: [{ coding: [{ code: "notification", display: "Follow-up Notification" }] }],
    subject: { reference: "Patient/PAT-55555", display: "Santos, Maria" },
    sender: { reference: "Practitioner/PROV-444", display: "Dr. Michael Ross" },
    payload: [{ contentString: "Patient needs 2-week follow-up after cardiac catheterization." }],
    sent: "2026-01-31T14:00:00Z",
  };
  const commResults = parser.parse(comm);
  assert(commResults.length === 1, "Communication: parsed 1 message");
  assert(commResults[0].messageType === "FOLLOW_UP_NEEDED", "Communication: detected follow-up type");
  assert(commResults[0].content.body.includes("cardiac catheterization"), "Communication: body preserved");

  // Test Bundle (multiple resources)
  const bundle = {
    resourceType: "Bundle" as const,
    type: "searchset",
    entry: [
      { resource: diagReport },
      { resource: critObs },
      { resource: medReq },
    ],
  };
  const bundleResults = parser.parse(bundle);
  assert(bundleResults.length === 3, "Bundle: parsed 3 messages from bundle");

  // Test JSON string input (simulates raw webhook body)
  const jsonString = JSON.stringify(critObs);
  const strResults = parser.parse(jsonString);
  assert(strResults.length === 1, "String input: parsed JSON string correctly");
  assert(strResults[0].content.labResults?.[0]?.flag === "critical", "String input: preserved critical flag");

  // Test empty/unknown resource
  const unknownResource = { resourceType: "Patient" as const, id: "PAT-00000" };
  const unknownResults = parser.parse(unknownResource as any);
  assert(unknownResults.length === 0, "Unknown resource: returns empty array");
}

function testSyntheticDataGeneration(): void {
  console.log("\n--- Synthetic Data Generation Tests ---\n");
  const scenarios = generateScenarios();

  assert(scenarios.length === 8, `Generated ${scenarios.length} scenarios (expected 8)`);

  const types = scenarios.map((s) => s.message.messageType);
  assert(types.includes("LAB_RESULT"), "Includes LAB_RESULT scenario");
  assert(types.includes("SCHEDULE_STUDY"), "Includes SCHEDULE_STUDY scenario");
  assert(types.includes("MEDICATION_REFILL"), "Includes MEDICATION_REFILL scenario");
  assert(types.includes("FOLLOW_UP_NEEDED"), "Includes FOLLOW_UP scenario");
  assert(types.includes("CALL_OFFICE"), "Includes CALL_OFFICE scenario");
  assert(types.includes("LAB_ORDER_REQUEST"), "Includes LAB_ORDER_REQUEST scenario");

  // Verify critical scenarios exist
  const criticalScenarios = scenarios.filter(
    (s) => s.message.content.urgency === "critical"
  );
  assert(criticalScenarios.length >= 1, `Has ${criticalScenarios.length} critical scenario(s)`);

  // Verify all scenarios have required fields
  for (const s of scenarios) {
    assert(!!s.message.patient.mrn, `${s.name}: has MRN`);
    assert(!!s.message.messageId, `${s.name}: has message ID`);
    assert(!!s.message.epicDeepLink, `${s.name}: has Epic deep link`);
  }
}

// Run all tests
console.log("===========================================");
console.log("  OpenClaw Medical Agent - Offline Tests");
console.log("  v0.2.0 (+ FHIR R4 / Community Connect)");
console.log("===========================================");

testHL7Parser();
testEpicDeepLinks();
testFHIRParser();
testSyntheticDataGeneration();

console.log("\n===========================================");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("===========================================\n");

if (failed > 0) process.exit(1);
