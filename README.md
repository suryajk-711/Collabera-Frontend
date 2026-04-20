# GenAI Document Review Service

---

## Section A: Architecture and Design Rationale

### Where the Service Lives

The AI Review Service is a new Spring Boot microservice that sits between the Document Service and the Underwriting Service. It does not touch anything in the existing three services. The Application Service still owns applicant data. The Document Service still handles file storage. Underwriting still makes the final decision. This new service plugs into the gap that currently requires a loan officer to manually read a pay stub and type the numbers in by hand.

The service is stateless. It does not own a database. All persistence lives where it already lives — application records in the Application Service, raw files in the Document Service. This was a deliberate choice to avoid introducing new infrastructure and to keep the service deployable on the existing ECS setup without new RDS instances or S3 buckets.

```
Angular Dashboard (review-dashboard.component)
        |
        | POST /api/review/extract
        v
ExtractionController
        |
        |-- DocumentServiceClient      (fetch raw pay stub)
        |-- ApplicationServiceClient   (fetch self-reported income/employer)
        |-- PiiRedactionService        (strip SSN, DOB, account numbers)
        |-- LlmService                 (send redacted text, get structured JSON)
        |-- DiscrepancyService         (compare extracted vs self-reported)
        |-- AuditLogService            (log every extraction event)
        |
        v
ExtractionResult (per-field decisions, flags, confidence)
        |
        | POST /api/review/approve
        v
Underwriting Service
```

The Angular side mirrors this structure. A `ReviewService` handles all HTTP calls. An `AuthInterceptor` attaches the JWT on every request. The `ReviewDashboardComponent` handles display and the officer approval workflow. Models are defined as TypeScript interfaces that map directly to the Java response shapes.

### Key Design Decisions

**Separate service, not a module inside an existing one.** LLM calls are slow, can fail in unpredictable ways, and have no business being mixed into loan state management or document storage. Keeping this as its own service means failures here do not cascade into Application or Document service availability. It also lets the service scale independently if extraction volume spikes.

**Per-field decisions, not per-document.** The `ExtractionResult` model holds a list of `ExtractedField` objects, each with its own value, confidence score, discrepancy flag, and officer decision (`ACCEPTED`, `EDITED`, `REJECTED`). This is more work than a simple approve/reject on the whole document, but it reflects how a real loan officer actually works. An officer might trust the income figure but want to correct the pay period. Collapsing this into one decision throws away information that is useful both for the workflow and for auditing.

**Audit log on every extraction.** The `AuditLogService` records who triggered the extraction, what the LLM returned, what the officer changed, and when the approval was submitted. In a regulated environment this is not optional. Having it stubbed in from the start means the real implementation slots in without restructuring anything else.

**Mandatory human review before Underwriting sees anything.** The `OfficerApprovalRequest` is what flows to Underwriting, not the raw LLM output. The officer has to explicitly submit a decision on each field. There is no auto-approve path, even at high confidence scores. Lending is a regulated domain and a hallucinated income figure silently reaching an underwriting decision is a compliance failure, not just a bug.

One alternative I considered was running the LLM extraction asynchronously and polling for results. The assignment explicitly prohibits introducing new message brokers, and for a POC the synchronous flow is much clearer to follow. Async processing is the right answer at scale and is the first thing to revisit in a production sprint.

### Data Flow

1. Loan officer selects an application and uploads a pay stub in the Angular dashboard
2. `ReviewService` calls `POST /api/review/extract` with the file and application ID
3. `ExtractionController` receives the request, Spring Security verifies the loan officer role
4. `DocumentServiceClient` fetches the raw file (stubbed for POC; real implementation uses S3 presigned URL)
5. `ApplicationServiceClient` fetches the applicant's self-reported income and employer (stubbed)
6. `PiiRedactionService` runs regex over the extracted text, replacing SSNs, DOBs, and account numbers with typed placeholders before anything goes to the LLM
7. `LlmService` sends the redacted text with a structured prompt and parses the JSON response into an `ExtractionResult`
8. `DiscrepancyService` compares each extracted field against self-reported values and sets `DiscrepancyFlag` values where differences exceed the threshold
9. `AuditLogService` records the extraction event
10. The full `ExtractionResult` returns to Angular
11. `ReviewDashboardComponent` renders a field-by-field comparison table with flag highlighting
12. Loan officer works through each `ExtractedField`, accepting, editing, or rejecting
13. Officer submits an `OfficerApprovalRequest`
14. `ExtractionController` forwards the approved payload to the Underwriting Service

### PII Handling

The `PiiRedactionService` runs before any text is handed to `LlmService`. It applies regex patterns targeting Social Security Numbers in standard and compact formats, dates of birth, and bank routing and account numbers. Matched content gets replaced with typed placeholders like `[SSN-REDACTED]` and `[DOB-REDACTED]` so the LLM prompt stays coherent while the actual values are gone.

The limitation is that regex works on known patterns. Unusual formatting or non-standard separators can cause misses. False positives are also possible if a sequence happens to match a pattern without being PII. For production, a proper detection library like Microsoft Presidio or AWS Comprehend would cover more cases and produce an auditable redaction log. The architectural slot already exists in the service layer. Swapping `PiiRedactionService` internals does not require touching the controller or the LLM call.

---

## Section B: Production Readiness and Leadership

### B1: What Would Need to Change Before This Goes to Production

**LLM failures and hallucinations**

Every field in `ExtractionResult` needs schema validation before it leaves the service. If the LLM returns a monthly income of zero, a negative number, or a string where a number is expected, that needs to be caught at the `LlmService` level before the response reaches the controller. The stub in this POC returns a well-formed response by design. The real implementation needs to handle malformed JSON, timeouts, rate limit errors, and values that are plausible-looking but wrong. Retry with exponential backoff covers transient failures. A fallback that returns an empty `ExtractionResult` with `status: EXTRACTION_FAILED` and surfaces a manual entry prompt to the officer covers the rest.

**Monitoring and observability**

Standard uptime metrics are not enough here. The metrics that matter are: what percentage of extracted fields officers accept without editing, which fields get corrected most often, LLM latency per request, and confidence score distribution over time. A sustained drop in acceptance rate is an early signal that model output quality has degraded before it becomes a compliance problem. Structured logs with a correlation ID tying each extraction to an application ID make post-hoc auditing possible. The `AuditLogService` stub is the right place for this and is already positioned correctly in the architecture.

**Security hardening**

The LLM API key needs to come from AWS Secrets Manager, not `application.properties`. The Spring Security config already gates the extraction endpoints by role, which is the right starting point. The next layer is ensuring the LLM API call goes through a network egress allowlist at the ECS task level so only the approved provider endpoint is reachable from the service. Internal service-to-service calls (Application Service, Document Service) should use service mesh mTLS rather than plain HTTP with stubbed clients.

**Rollback strategy**

The AI extraction should be behind a feature flag before it touches real traffic. If extraction quality drops or the provider has an outage, the flag disables AI extraction without a deployment and officers fall back to manual entry, exactly how they work today. Before full launch, run a shadow period where extractions happen in the background and the results are compared against what officers enter manually. If accuracy is not good enough, the feature does not go live. This period also generates labeled data useful for evaluating whether a different model or prompt produces better results.

---

### B2: Catching AI Mistakes

When I was designing the model layer, I asked an AI assistant to help me think through what enums I needed for the extraction workflow. It came back with a single DiscrepancyFlag enum covering things like income mismatch and employer mismatch. On the surface that looked fine and I almost went with it.

The problem was it only modeled what the LLM could flag. It had nothing to do with what happens after the officer looks at the result. I realized the AI was thinking about the extraction step in isolation. It was not thinking about the full lifecycle of a field moving through the system.

What I actually needed was two more enums. ExtractionStatus to track whether the extraction succeeded, partially failed, or errored out. And OfficerDecision to capture what the loan officer did with each field, whether they accepted it, edited it, or rejected it entirely.

The incorrect output would have worked fine in a demo. Upload a file, see the flags, looks good. The gap would only show up when you tried to build the audit log or the approval submission, because you would have no structured way to record what the officer actually decided on each field. That is what made me catch it. I asked myself: what does the OfficerApprovalRequest actually send to Underwriting, and how do I know which fields the officer changed? The basic enum structure had no answer for that.

---

## Section C: AI Usage Log

I had the overall architecture figured out before I opened any AI tool. I knew the service had to be stateless, PII redaction had to happen server-side inside the service boundary before the LLM call, and I wanted per-field decisions rather than a single document-level approve/reject. I used Claude to move faster on implementation details and to gut-check a few decisions I had already made.

**Interaction 1: Architecture validation**

I described the three existing services and the new one I was building, including where `DocumentServiceClient` and `ApplicationServiceClient` would sit relative to the controller. Claude confirmed the approach and noted that keeping the service stateless would make ECS deployment straightforward without new infrastructure. I had already made that call but the conversation helped me sharpen the reasoning I put in Section A.

**Interaction 2: Model structure**

I had the shape of `ExtractionResult` and `ExtractedField` in mind and asked Claude to help me think through what the enums needed to cover. It suggested a basic discrepancy flag enum. I went further and added `ExtractionStatus` and `OfficerDecision` because the per-field tracking of what the officer actually did (`ACCEPTED`, `EDITED`, `REJECTED`) was something I wanted from the start and the basic suggestion did not cover it. The `AuditLogService` stub also came out of this conversation. Once the model structure was clear, it was obvious I needed a record of the delta between LLM output and officer-approved output, not just that an extraction happened.

**Interaction 3: Spring Security and Angular interceptor**

I asked for help wiring the role-based access on the extraction endpoints and the matching auth interceptor on the Angular side. Claude gave me the `@PreAuthorize` annotation setup and an `HttpInterceptor` skeleton. I kept the structure but rewrote the interceptor to match the JWT format the platform already uses rather than the generic Bearer token format it assumed. I also added the 401 redirect path, which the skeleton did not handle.