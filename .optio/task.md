# feat: Cost optimization insights and forecasting

feat: Cost optimization insights and forecasting

## Problem

Cost tracking shows totals but doesn't help users optimize. No way to compare models, detect anomalies, or forecast spending.

## Features

- **Per-model cost comparison**: Show cost breakdown by model (Opus vs Sonnet vs Haiku) with success rates
- **"Try cheaper model" suggestions**: If a task succeeded with Opus, suggest trying Sonnet next time
- **Cost anomaly alerts**: Flag tasks that cost 3x+ the repo average
- **Forecasting**: "At current rate, you'll spend $X this month"
- **Per-task cost breakdown**: Input tokens, output tokens, thinking tokens (where available)
- **Token tracking**: Store `inputTokens`, `outputTokens` on tasks for detailed analysis

## Acceptance Criteria

- [ ] Cost breakdown by model on analytics page
- [ ] Anomaly detection with visual indicators
- [ ] Monthly forecast based on rolling average
- [ ] Token-level cost breakdown per task

---

_Optio Task ID: 428ee0d9-6ba2-482e-aed6-2b6b74b44baa_
