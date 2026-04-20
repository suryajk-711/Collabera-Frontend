import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ExtractionResult } from '../models/extraction-result.model';
import { ApprovalResponse, OfficerApprovalRequest } from '../models/officer-approval-request.model';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly http    = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/review`;

  extractPayStub(applicationId: string, file: File): Observable<ExtractionResult> {
    const form = new FormData();
    form.append('applicationId', applicationId);
    form.append('file', file);
    return this.http.post<ExtractionResult>(`${this.baseUrl}/extract`, form);
  }

  approveFields(request: OfficerApprovalRequest): Observable<ApprovalResponse> {
    return this.http.post<ApprovalResponse>(`${this.baseUrl}/approve`, request);
  }
}