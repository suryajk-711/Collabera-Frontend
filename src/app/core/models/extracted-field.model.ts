import { DiscrepancyFlag, OfficerDecision } from './enums';

export interface ExtractedField {
  fieldName:            string;
  fieldKey:             string;
  aiExtractedValue:     string | null;
  selfReportedValue:    string | null;
  flag:                 DiscrepancyFlag;
  confidenceScore:      number;
  decision:             OfficerDecision;
  officerOverrideValue: string | null;
}