import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReviewService } from '../../core/services/review.service';
import { ExtractedField } from '../../core/models/extracted-field.model';
import { ExtractionResult } from '../../core/models/extraction-result.model';
import { OfficerDecision, DiscrepancyFlag, ExtractionStatus } from '../../core/models/enums';
import { OfficerApprovalRequest } from '../../core/models/officer-approval-request.model';

// Extends ExtractedField with local UI state for each row
interface FieldRow {
  field:     ExtractedField;
  isEditing: boolean;
  editValue: string;
}

type DashboardState = 'idle' | 'loading' | 'review' | 'submitting' | 'submitted';

@Component({
  selector: 'app-review-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './review-dashboard.component.html',
  styleUrl: './review-dashboard.component.scss'
})
export class ReviewDashboardComponent {
  private readonly reviewService = inject(ReviewService);

  // ── State ──────────────────────────────────────────────────────────────
  state             = signal<DashboardState>('idle');
  extractionResult  = signal<ExtractionResult | null>(null);
  fieldRows         = signal<FieldRow[]>([]);
  submissionResult  = signal<string | null>(null);
  errorMessage:       string | null = null;

  // ── Form (plain properties — ngModel doesn't bind to signals) ──────────
  applicationId = 'APP-1234';
  selectedFile: File | null = null;

  // ── Computed ───────────────────────────────────────────────────────────
  allReviewed = computed(() =>
    this.fieldRows().length > 0 &&
    this.fieldRows().every(r => r.field.decision !== OfficerDecision.PENDING)
  );

  mismatchCount = computed(() =>
    this.fieldRows().filter(r => r.field.flag === DiscrepancyFlag.MISMATCH).length
  );

  getRowClass(row: FieldRow): string {
    const classes: string[] = [`row-${row.field.flag.toLowerCase()}`];
    if (row.field.decision !== OfficerDecision.PENDING) classes.push('row-decided');
    return classes.join(' ');
    }

  // ── Enums exposed to template ──────────────────────────────────────────
  readonly OfficerDecision  = OfficerDecision;
  readonly DiscrepancyFlag  = DiscrepancyFlag;
  readonly ExtractionStatus = ExtractionStatus;

  // ── Actions ────────────────────────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.selectedFile = input.files[0];
  }

  onExtract(): void {
    if (!this.applicationId.trim() || !this.selectedFile) return;
    this.state.set('loading');
    this.errorMessage = null;

    this.reviewService.extractPayStub(this.applicationId, this.selectedFile).subscribe({
      next: (result) => {
        this.extractionResult.set(result);
        this.fieldRows.set(result.fields.map(f => ({
          field:     { ...f },
          isEditing: false,
          editValue: f.aiExtractedValue ?? ''
        })));
        this.state.set('review');
      },
      error: () => {
        this.errorMessage = 'Extraction failed. Check the backend is running and try again.';
        this.state.set('idle');
      }
    });
  }

  acceptField(i: number): void {
    this.mutateRow(i, r => { r.field.decision = OfficerDecision.ACCEPTED; r.isEditing = false; });
  }

  startEdit(i: number): void {
    this.mutateRow(i, r => { r.isEditing = true; r.editValue = r.field.aiExtractedValue ?? ''; });
  }

  saveEdit(i: number): void {
    this.mutateRow(i, r => {
      r.field.decision             = OfficerDecision.EDITED;
      r.field.officerOverrideValue = r.editValue;
      r.isEditing                  = false;
    });
  }

  cancelEdit(i: number): void {
    this.mutateRow(i, r => { r.isEditing = false; });
  }

  rejectField(i: number): void {
    this.mutateRow(i, r => { r.field.decision = OfficerDecision.REJECTED; r.isEditing = false; });
  }

  undoDecision(i: number): void {
    this.mutateRow(i, r => {
      r.field.decision             = OfficerDecision.PENDING;
      r.field.officerOverrideValue = null;
      r.isEditing                  = false;
    });
  }

  onSubmit(): void {
    if (!this.allReviewed()) return;
    this.state.set('submitting');

    const request: OfficerApprovalRequest = {
      applicationId: this.extractionResult()!.applicationId,
      documentId:    this.extractionResult()!.documentId,
      decisions: this.fieldRows().map(r => ({
        fieldKey:             r.field.fieldKey,
        decision:             r.field.decision,
        officerOverrideValue: r.field.officerOverrideValue ?? null
      }))
    };

    this.reviewService.approveFields(request).subscribe({
      next: (res) => {
        this.submissionResult.set(res.underwritingResponse);
        this.state.set('submitted');
      },
      error: () => {
        this.errorMessage = 'Submission failed. Please try again.';
        this.state.set('review');
      }
    });
  }

  reset(): void {
    this.state.set('idle');
    this.extractionResult.set(null);
    this.fieldRows.set([]);
    this.selectedFile    = null;
    this.errorMessage    = null;
    this.applicationId   = 'APP-1234';
    this.submissionResult.set(null);
  }

  // ── Private ────────────────────────────────────────────────────────────
  private mutateRow(i: number, fn: (row: FieldRow) => void): void {
    const rows = [...this.fieldRows()];
    fn(rows[i]);
    this.fieldRows.set(rows);
  }
}