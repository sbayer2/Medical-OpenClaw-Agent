// Task dispatcher - executes actions determined by the agent via Clarity Connect

import type { AgentAction } from "../core/types.js";
import type { ClarityAdapter, ClarityResponse } from "../clarity/adapter.js";

export class TaskDispatcher {
  private clarity: ClarityAdapter;

  constructor(clarity: ClarityAdapter) {
    this.clarity = clarity;
  }

  async execute(action: AgentAction): Promise<ClarityResponse> {
    switch (action.type) {
      case "ORDER_LAB":
        return this.clarity.submitLabOrder(action.details);

      case "SEND_FOLLOW_UP":
        return this.clarity.sendFollowUp(action.details);

      case "SCHEDULE_STUDY":
        return this.clarity.scheduleStudy(action.details);

      case "CALL_OFFICE":
        return this.clarity.routeOfficeCall(
          action.details.patientMrn,
          action.details.reason,
          action.details.callbackNumber,
          action.details.urgency
        );

      case "MEDICATION_REFILL":
        return this.clarity.processMedicationRefill(
          action.details.patientMrn,
          action.details.medication,
          action.details.dose,
          action.details.refillQuantity
        );

      case "ACKNOWLEDGE":
        console.log(
          `[Dispatcher] Acknowledged: MRN ${action.details.patientMrn} - ${action.details.acknowledgmentNote}`
        );
        return {
          success: true,
          transactionId: `ACK-${Date.now()}`,
          message: `Acknowledged for MRN ${action.details.patientMrn}`,
        };

      case "ESCALATE":
        console.log(
          `[Dispatcher] ESCALATION: MRN ${action.details.patientMrn} -> ${action.details.escalateTo} (${action.details.urgency})`
        );
        return {
          success: true,
          transactionId: `ESC-${Date.now()}`,
          message: `Escalated to ${action.details.escalateTo} for MRN ${action.details.patientMrn}`,
        };

      case "NO_ACTION":
        console.log(`[Dispatcher] No action: ${action.reason}`);
        return {
          success: true,
          transactionId: `NOOP-${Date.now()}`,
          message: `No action required: ${action.reason}`,
        };
    }
  }
}
