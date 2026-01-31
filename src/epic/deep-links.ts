// Epic Haiku deep link generator for iPhone
// These links open specific patient charts directly in the Epic Haiku app

export class EpicDeepLinks {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Build a deep link to open a patient chart in Epic Haiku on iPhone.
   * Epic Haiku uses the `epic://` or `epichaiku://` URI scheme.
   *
   * Placeholder format - actual format depends on your Epic instance configuration.
   * Common patterns:
   *   epichaiku://open/patient?id={epicPatientId}
   *   epic-haiku://chart/{epicPatientId}
   *   {baseUrl}/Haiku/api/epic/chart/{epicPatientId}
   */
  buildPatientChartLink(epicPatientId: string): string {
    // Primary: Epic Haiku URI scheme (opens iPhone app directly)
    return `epichaiku://open/patient?id=${encodeURIComponent(epicPatientId)}&source=openclaw`;
  }

  /**
   * Build a web-based link to the patient chart (fallback for non-mobile).
   */
  buildWebChartLink(epicPatientId: string): string {
    return `${this.baseUrl}/EpicCareLink/common/chart.asp?PAT_ID=${encodeURIComponent(epicPatientId)}`;
  }

  /**
   * Build a deep link to a specific lab result in Haiku.
   */
  buildLabResultLink(epicPatientId: string, orderId: string): string {
    return `epichaiku://open/patient?id=${encodeURIComponent(epicPatientId)}&view=results&order=${encodeURIComponent(orderId)}&source=openclaw`;
  }

  /**
   * Build a deep link to the orders section for a patient.
   */
  buildOrdersLink(epicPatientId: string): string {
    return `epichaiku://open/patient?id=${encodeURIComponent(epicPatientId)}&view=orders&source=openclaw`;
  }

  /**
   * Build a deep link to the scheduling view for a patient.
   */
  buildSchedulingLink(epicPatientId: string): string {
    return `epichaiku://open/patient?id=${encodeURIComponent(epicPatientId)}&view=scheduling&source=openclaw`;
  }

  /**
   * Build a deep link to the messaging view (for follow-up notifications).
   */
  buildMessagingLink(epicPatientId: string): string {
    return `epichaiku://open/patient?id=${encodeURIComponent(epicPatientId)}&view=messaging&source=openclaw`;
  }
}
