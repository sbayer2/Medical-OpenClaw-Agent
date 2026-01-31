// Quick test runner - runs offline tests only (no API key needed)

import { HL7Parser } from "../epic/hl7-parser.js";
import { EpicDeepLinks } from "../epic/deep-links.js";
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
console.log("===========================================");

testHL7Parser();
testEpicDeepLinks();
testSyntheticDataGeneration();

console.log("\n===========================================");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("===========================================\n");

if (failed > 0) process.exit(1);
