# Ship's Memory · Maritime Crew Handover Intelligence Platform

**Ship's Memory** is an AI-powered maritime engineering handover solution designed for merchant vessels (featuring the engine department of **MV Coral Meridian**). It bridges technical communication gaps across crew rotations by transforming maintenance logs, defect notices, and emails into high-priority actionable briefings through structured Gemini AI analysis.

---

## Architecture Overview

The system orchestrates a 3-stage handover pipeline between three primary maritime roles:
1. **Office (Superintendent Anita):** Ingests Planned Maintenance System (PMS) CSV records and technical notes, utilizes Gemini to detect repeat repairs, deferred overhauls, and unaddressed alarms, and formulates targeted questions.
2. **Outgoing Chief Engineer (Ravi):** Responds to questions using natural multilingual voice or text (Hindi, Tagalog, English). Gemini detects language, performs nautical-grade English translation, and poses real-time follow-ups for safety-critical omissions.
3. **Incoming Chief Engineer (Jose):** Reviews a consolidated, priority-ranked briefing with immediate watchstanding action items, listens to audio readouts, prints Engine Control Room (ECR) sheets, and queries an AI Q&A chatbot strictly grounded in the ship's maintenance logs and Ravi's interview.

---

## 1. Prerequisites & Environment Setup

Ensure you have installed:
- [Node.js](https://nodejs.org/) v20 or v22
- [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install)
- [Docker](https://docs.docker.com/get-docker/) (for local containerized testing)

### Enable Required Google Cloud APIs

```bash
# Set your active Google Cloud project
gcloud config set project YOUR_PROJECT_ID

# Enable Cloud Run, Secret Manager, Cloud Build, and Cloud Firestore APIs
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com
```

---

## 2. Secret Management & Zero-Hardcoding Hygiene

All Gemini AI calls execute on the server backend without exposing API tokens to client bundles. Store your Gemini API key in Google Cloud Secret Manager:

```bash
# 1. Create and populate the secret
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# 2. Retrieve your Google Cloud project number
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# 3. Grant the Cloud Run runtime service account access to read the secret
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 3. Database Security Configuration (Cloud Firestore)

Deploy secure, owner-bound rules ensuring user interaction isolation and vessel document security:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/interactions/{interactionId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

To deploy rules to your project:
```bash
firebase deploy --only firestore:rules
```

---

## 4. Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment file
cp .env.example .env
# Edit .env and supply your GEMINI_API_KEY

# 3. Boot full-stack development server
npm run dev
# Server listening on http://localhost:3000
```

---

## 5. Google Cloud Run Deployment

Deploy containerized Ship's Memory directly to Google Cloud Run:

```bash
# Build and deploy from source via Cloud Build & Cloud Run
gcloud run deploy ships-memory \
  --source=. \
  --region=europe-west2 \
  --platform=managed \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --memory=512Mi \
  --cpu=1
```

### Mandatory Verification Binding (Challenge Registration)

To register your deployed Cloud Run service for challenge verification, apply the required campaign resource label:

```bash
gcloud run services update ships-memory \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=europe-west2
```

---

## 6. Gemini Resilient Fallback Ladder

The server integrates `@google/genai` utilizing a model fallback ladder to handle potential quota limits or transient API outages seamlessly:
1. `gemini-3.6-flash` (Primary)
2. `gemini-3.1-flash-lite` (High Availability)
3. `gemini-flash-latest` (Dynamic Alias)
4. `gemini-3.7-flash` (Deep Reasoning Fallback)
