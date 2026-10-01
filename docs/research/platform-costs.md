# Research: Gemini API and AWS: pricing, lifecycle, limits

Researched 2026-09-25 from official pages. **UNVERIFIED** marks anything not confirmed from an official source. **No API calls were made.**

## Gemini (ai.google.dev, pages dated 2026-09-20..25)

### Models (paid Standard tier, per 1M tokens)

| Model ID | Input / Output | Status |
|---|---|---|
| `gemini-2.5-flash-lite` | $0.10 / $0.40 | Stable (2025-07-22). **Since 2026-09-18, access limited to past users.** New projects are directed to 3.5 Flash-Lite. |
| **`gemini-3.1-flash-lite`** | **$0.25 / $1.50** | Stable since 2026-05-07. **Earliest shutdown 2027-05-07** (replacement: 3.5 Flash-Lite) |
| `gemini-3.5-flash-lite` | $0.30 / $2.50 | Stable since 2026-07-21 |

- All three: 1,048,576-token input / 65,536-token output limits, function calling, thinking tokens billed at the output price.
- `gemini-3.1-flash-lite-preview` was shut down on 2026-05-25.
- Do not use the `gemini-flash-lite-latest` alias.

### Thinking and output limits

- **3.x models:** `thinkingLevel` takes minimal / low / medium / high. `minimal` "does not guarantee that thinking is off".
- **2.5:** thinking is off by default. `thinkingBudget = 0` is legacy (UNVERIFIED).
- Sending both `thinking_level` and `thinking_budget` returns HTTP 400.
- **`maxOutputTokens` includes thinking tokens.** Thinking tokens are still billed even if the output is truncated.

### Usage metadata and billing

- `usageMetadata` fields: `promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`, `toolUsePromptTokenCount`, `thoughtsTokenCount`, `totalTokenCount`, `serviceTier`.
- Cost = prompt × input price + (candidates + thoughts) × output price.
- Calls that fail with 400/500 are not billed but still count toward quota.

### Token counting

- The billing FAQ says "`GetTokens` API ... not billed, don't count against inference quota". That this is the same as `countTokens` is UNVERIFIED.
- `countTokens` accepts a full generate request, and function declarations count as input tokens.
- Local tokenizers exist for Python (experimental) and Go. A JS/TS one is UNVERIFIED.

### Free tier

- All three Flash-Lite models are free of charge on the free tier. The rate limits are only shown in AI Studio (UNVERIFIED).
- **Data use:** content is used "to provide, improve, and develop Google products", and "human reviewers may read, annotate, and process your API input and output".
- **EEA / Switzerland / UK:** apps offered to users there must use Paid Services only.
- Argentina is in the available-regions list.
- **Age:** users must be 18+. Apps must not be "directed towards or ... likely to be accessed by individuals under the age of 18".

### Billing controls

- **Prepay:** minimum $5; credit expires after 12 months. At a $0 balance every call returns HTTP 402, with roughly 10 minutes of possible overage.
- **AI Studio project spend cap:** monthly; marked "experimental".
- **Cloud Billing spend-cap budget:** in preview; enforcement is not instant.
- **Plain Cloud budgets:** alerts only.
- **Tier 1 accounts:** capped at $250/month, and at $10 per rolling 10 minutes.
- The $300 Google Cloud welcome credit can't be used for the Gemini API on accounts created after 2026-03-02.

### Tools and grounding

- Google Search grounding is billed only if enabled: 3.x gets 5,000 free queries/month, then $14 per 1,000.
- Function calling has no separate fee (tokens only). A tool round trip means ≥ 2 calls, with the history resent each time.

### Worst-case cost at 2,000 input + 512 output tokens per call

| Model | Per call | 200 calls/month | 930 calls/month (abuse case) |
|---|---|---|---|
| 3.1 Flash-Lite | $0.001268 | **$0.2536** | $1.179 |
| 3.5 Flash-Lite | $0.00188 | $0.376 | $1.748 |

### SDK and keys

- `@google/genai` v2.24.0 (2026-09-22), Node ≥ 20. The older SDKs were deprecated on 2025-11-30.
- AI Studio has issued "auth keys" since 2026-05-28. They are restricted to the Generative Language API by default. Standard keys are being rejected from September 2026.

## AWS (price-list files published 2026-09; us-east-1 unless noted)

### Free Tier

- **Accounts created on or after 2025-07-15:**
  - $100 in credits at signup, plus up to $100 more; credits expire 12 months after the account is created.
  - **Free plan:** ends after 6 months or when credits run out, then the account closes (data kept for 90 days, upgrade possible).
  - **Paid plan:** pay-as-you-go.
- **The legacy 12-month free tier has expired for every account**, so API Gateway's 1M free calls are gone.
- **Always free:**
  - Lambda: 1M requests + 400k GB-s.
  - DynamoDB: 25 GB + 25 RCU/WCU (provisioned mode only).
  - CloudFront: 1 TB transfer, 10M requests, 2M Functions invocations.
  - CloudWatch: 5 GB logs.
  - KMS: 20k requests.
  - Cognito: 10k MAU.

### Cognito

- **Prices:** Lite $0.0055/MAU; Essentials $0.015 (the default plan); Plus $0.02. The 10k free MAU are shared between Lite and Essentials.
- **Lite lacks:** managed login (classic hosted UI only), access-token customization, passwordless, `USER_AUTH` choice-based auth, email MFA, refresh-token rotation.
- **Pre sign-up `autoConfirmUser`:** confirmed users can sign in immediately. Whether `AutoVerifiedAttributes` still sends an email in this case is UNVERIFIED.
- **Unverified emails:** such users can sign in if the email is the username (not if it is an alias).
- **ForgotPassword:** with no verified email or phone it returns `InvalidParameterException`, and the user "is locked out".
  - Recovery options: `verified_email`, `verified_phone_number`, `admin_only`.
  - Admin fix: `AdminUpdateUserAttributes(email_verified)` or `AdminSetUserPassword`.
- **Verify later:** `GetUserAttributeVerificationCode` + `VerifyUserAttribute`.
- **Email sending:** the default Cognito sender allows **50 emails/day per account**; beyond that you need SES.
- **SPA clients:** use a public client without a secret and `USER_SRP_AUTH`.
- **HTTP API JWT authorizer:** checks `aud` or `client_id`, which means ID tokens also pass by default. Fix: use access tokens, set the audience to the client ID, and require the scope `aws.cognito.signin.user.admin`.

### API Gateway (HTTP API)

- $1.00 per million requests ($1.59 in sa-east-1).
- **Cannot stream responses** (only REST API can, at $3.50 per million).
- The default account throttle is 10k requests/s. Set low stage and route throttles.

### CloudFront

- **Flat-rate plans:**

  | Plan | Price/month | Requests | Transfer | WAF rules |
  |---|---|---|---|---|
  | Free | $0 | 1M | 100 GB | 5 |
  | Pro | $15 | 10M | 50 TB | — |

  - No overage charges.
  - Custom response-header policies require the Business plan; CSP would go in a CloudFront Function instead.
  - **Accounts using the AWS Free Tier are ineligible.** Whether a Paid-plan account still holding credits counts as Free Tier is UNVERIFIED.
- **Pay-as-you-go** (outside the always-free allowance): South America $0.110/GB and $0.022 per 10k HTTPS requests.
- **Headers:** response-headers policies are free; the managed security-headers policy has no CSP.
- **WAF on pay-as-you-go:** $5 per web ACL + $1 per rule + $0.60 per million requests.

### DynamoDB

- On-demand: $0.625/M writes, $0.125/M reads; storage $0.25/GB after 25 GB.
- Transactions cost 2× and are charged even when cancelled. Failed conditional writes consume WCU.
- TTL deletes are free.
- A per-table maximum-throughput setting exists.

### Other services

- **SSM:** standard parameters and throughput are free (40 TPS). The `aws/ssm` key has no monthly fee, but decrypts count as KMS requests; cache the value. A customer-managed KMS key costs $1/month.
- **Budgets:** free; the first 2 action-enabled budgets are free. Data refreshes about 3 times a day. Budget actions **cannot stop public traffic**. **There is no hard cap** except the Free account plan.
- **Lambda:**
  - Reserved concurrency is free, and setting it to 0 blocks all invocations.
  - At least 100 concurrency must stay unreserved. The "new accounts have 10" figure is UNVERIFIED.
  - Response streaming costs $0.008/GB beyond 6 MB.
- **Region:** Lambda and Cognito cost the same in both regions. DynamoDB is 1.5× in sa-east-1, API Gateway 1.59×, S3 $0.0405 vs $0.023, logs $0.90 vs $0.50.

### Demo cost model

Assumptions: 50 MAU, 2k API calls, 3 GB of tiles, 20 GB of transfer.

| Region | Monthly cost |
|---|---|
| us-east-1 | **≈ $0.12** |
| sa-east-1 | ≈ $0.20 |

- One-time tile upload: about $0.30 (60k PUTs).
- A Route 53 hosted zone adds $0.50/month.

### Residual risks that app quotas can't control

1. **Cognito sign-up spam:** the public SignUp API plus auto-confirm turns bots into MAUs. Past 10k, the worst case is roughly $20k/day on Lite. Whether rejected sign-ups count as MAU is UNVERIFIED.
2. **CloudFront floods on pay-as-you-go:** 100M requests ≈ $198 (South America rates).
3. **API Gateway floods:** billing of unauthorized requests is UNVERIFIED.
4. **Lambda invocations.**
5. **Log ingestion.**
6. **DynamoDB abuse:** mitigated by the max-throughput setting.

S3 does not bill 403 errors caused by requests from outside the account.

## Sources

- **Gemini (ai.google.dev):**
  - gemini-api/docs/{pricing, models, deprecations, thinking, tokens, rate-limits, billing, changelog, function-calling, gemini-3, google-search, api-key, libraries, available-regions}
  - gemini-api/terms
  - api/{generate-content, tokens, interactions-api}
- **Google Cloud (docs.cloud.google.com):**
  - apis/docs/capping-api-usage
  - billing/docs/how-to/{budgets, budgets-spend-caps}
- **npm registry:** @google/genai
- **AWS pricing (aws.amazon.com):**
  - /free/, /free/free-tier-faqs/
  - /{api-gateway, lambda, cognito, cloudfront, waf, systems-manager, kms, dynamodb/on-demand}/pricing
  - aws-budgets pricing
- **AWS docs (docs.aws.amazon.com):**
  - Cognito developer guide (feature plans, pre sign-up, recovery, email, quotas, auth flows, tokens) and API reference
  - API Gateway (JWT authorizer, quotas, throttling)
  - CloudFront (flat-rate plans, response headers)
  - SSM (parameter throughput, SecureString KMS)
  - DynamoDB (read/write operations, TTL, max throughput)
  - Budgets
  - Lambda (limits, concurrency)
  - Billing (free-tier plans)
- **AWS price-list API:** pricing.us-east-1.amazonaws.com/offers/v1.0/aws/*/current/{us-east-1,sa-east-1}/index.json
