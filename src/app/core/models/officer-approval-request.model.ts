import { OfficerDecision } from './enums';

export interface FieldDecision {
  fieldKey:             string;
  decision:             OfficerDecision;
  officerOverrideValue: string | null;
}

export interface OfficerApprovalRequest {
  applicationId: string;
  documentId:    string;
  decisions:     FieldDecision[];
}

export interface ApprovalResponse {
  status:                string;
  applicationId:         string;
  underwritingResponse:  string;
}