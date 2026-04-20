import { ExtractionStatus } from './enums';
import { ExtractedField } from './extracted-field.model';

export interface ExtractionResult {
  applicationId: string;
  documentId:    string;
  fields:        ExtractedField[];
  status:        ExtractionStatus;
  errorMessage:  string | null;
  extractedAt:   string;
}