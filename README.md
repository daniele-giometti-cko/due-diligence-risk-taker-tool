# Due Diligence — Agentic - Logs Teller Agent

An internal developer tool to query DynamoDB tables without writing expressions by hand.  
You describe what you want in plain English, the AI generates a DynamoDB query, you review it, then execute it.

---

## What it does

```
┌─────────────────────────────────────────────────────┐
│  Browser (Next.js · localhost:3000)                 │
│                                                     │
│  1. Type a natural-language question   ──┐          │
│     OR fill in the manual builder        │          │
│                                          ▼          │
│  2. Review & edit the generated JSON  ◄──┤          │
│                                          │          │
│  3. Click Execute                     ───┘          │
│                                                     │
│  4. Results appear in a table                       │
└──────────────────┬──────────────────────────────────┘
                   │ fetch
┌──────────────────▼──────────────────────────────────┐
│  .NET 8 API (localhost:5000)                        │
│                                                     │
│  POST /query/generate-query  → Anthropic Claude     │
│  POST /query/execute-query   → AWS DynamoDB         │
│  GET  /query/tables          → AWS DynamoDB         │
└─────────────────────────────────────────────────────┘
```

The AI **generates** the query but **never executes it**. You always see and can edit the JSON before anything touches DynamoDB.

---

## Prerequisites

| Requirement | Version |
|---|---|
| [.NET SDK](https://dotnet.microsoft.com/download) | 8.0+ |
| [Node.js](https://nodejs.org) | 18+ |
| AWS credentials configured | `~/.aws/credentials` or env vars |
| Anthropic API key | `sk-ant-...` |

---

## Setup

### 1. Configure the API

```bash
cd api

# Store the Anthropic API key in .NET user secrets (stored outside the repo, never committed)
dotnet user-secrets init
dotnet user-secrets set "Anthropic:ApiKey" "sk-ant-YOUR_KEY_HERE"
```

Open `api/appsettings.json` and set the correct AWS region if needed (default is `eu-west-1`):

```json
"AWS": {
  "Region": "eu-west-1"
}
```

### 2. Configure the frontend

The frontend ships with a pre-configured `.env.local` pointing to `http://localhost:5000`. No changes needed for local use.

---

## Running the tool

You need **two terminals** — one for the API, one for the UI.

### Terminal 1 — Start the API

```bash
cd api

# Point to the AWS account you want to query
export AWS_PROFILE=your-profile        # or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=eu-west-1   # override if needed

dotnet run
```

The API starts at **http://localhost:5000**.  
Swagger UI is available at **http://localhost:5000/swagger** for direct endpoint testing.

### Terminal 2 — Start the UI

```bash
cd ui
npm install   # first time only
npm run dev
```

The UI starts at **http://localhost:3000** — open this in your browser.

---

## Using the tool

### Option A — AI Query Generator

1. *(Optional)* Select a table from the dropdown to give the AI context.
2. Type your question in plain English, for example:
   - `Get all items where PK is USER#123`
   - `Scan for records where status is PENDING, limit 50`
   - `Query the orders index for customer CUST#456 sorted by date`
3. Click **Generate Query** — the AI returns a DynamoDB query as JSON.
4. The JSON appears in the **Query Preview** box. You can edit it directly.
5. Click **Execute Query** to run it.

### Option B — Manual Query Builder

1. Select an operation: **Query** or **Scan**.
2. Pick a table (or type a custom name).
3. Fill in the Partition Key name and value, and optionally a Sort Key.
4. Click **Build Query** — the builder populates the same JSON preview.
5. Click **Execute Query**.

### Query Preview (editable JSON)

Both paths produce a `DynamoQuery` JSON object you can freely edit before executing:

```jsonc
{
  "operation": "Query",           // "Query" or "Scan"
  "table": "my-table",
  "keyCondition": "PK = :pk",
  "filterExpression": null,       // optional filter (does not consume RCUs for key lookup)
  "expressionValues": {
    ":pk": "USER#123"
  },
  "indexName": null,              // set to a GSI name if needed
  "limit": null                   // max items to return; null = no limit
}
```

> **Tip:** Add `"indexName": "my-gsi"` directly in the preview to query a Global Secondary Index.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Anthropic:ApiKey is not configured` | Run `dotnet user-secrets set "Anthropic:ApiKey" "sk-ant-..."` inside `api/` |
| `AI returned unparseable JSON` | The model returned something unexpected. Try rephrasing your question to be more specific. |
| Tables dropdown is empty | AWS credentials may not be set, or the region is wrong. Check `AWS_PROFILE` / `AWS_DEFAULT_REGION`. |
| CORS error in browser | Ensure the API is running on port 5000 and the UI on port 3000. |
| `KeyCondition is required` | Switch operation to `Scan` in the JSON preview, or provide a partition key value. |

---

## Project structure

```
due-diligence-logs-teller-agent/
├── api/                    .NET 8 Web API
│   ├── Controllers/        HTTP endpoints
│   ├── Services/           AiQueryService (Anthropic) · DynamoDbService (AWS)
│   └── Models/             DynamoQuery — the shared query schema
└── ui/                     Next.js 14 frontend
    ├── app/                Single page (page.tsx holds all state)
    ├── components/         UI building blocks
    └── services/           queryService.ts — all API calls
```
