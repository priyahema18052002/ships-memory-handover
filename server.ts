/**
 * Ship's Memory - Production Full-Stack Server
 * Maritime Crew Handover Intelligence Platform
 * MV Coral Meridian (Engine Department)
 */

import express, { Request, Response, NextFunction } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production';

// 1. Mandatory Top-Level Request Deserialization (Ordering Guarantee)
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Utility: Strip undefined values for zero-crash database persistence
export function stripUndefined<T>(val: T): T {
  if (val === undefined || val === null) {
    return val;
  }
  return JSON.parse(JSON.stringify(val));
}

// Resilient Model Fallback Ladder
const MODEL_FALLBACK_LADDER = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];

// Initialize GenAI client safely with User-Agent telemetry
function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Resilient Helper: Execute generation with model fallback ladder
async function generateWithFallback(
  generateFn: (model: string, ai: GoogleGenAI) => Promise<any>
): Promise<{ result: any; modelUsed: string }> {
  const ai = getGenAIClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }

  let lastError: any = null;
  for (const model of MODEL_FALLBACK_LADDER) {
    try {
      const result = await generateFn(model, ai);
      return { result, modelUsed: model };
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode || 0;
      const msg = String(err?.message || '');
      const isRecoverable =
        status === 429 ||
        status === 503 ||
        status === 500 ||
        status === 404 ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('500') ||
        msg.includes('not found');

      console.warn(`[AI Fallback] Model ${model} encountered error:`, msg);
      if (!isRecoverable && MODEL_FALLBACK_LADDER.indexOf(model) === MODEL_FALLBACK_LADDER.length - 1) {
        break;
      }
    }
  }
  throw lastError || new Error('All fallback models exhausted.');
}

// --- Persistence Layer ---
interface Finding {
  id: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  title: string;
  summary: string;
  evidence: string[];
  question: string;
}

interface InterviewEntry {
  fid: string;
  original?: string;
  language?: string;
  english?: string;
  followUp?: string;
  skipped?: boolean;
}

interface FollowUpState {
  [findingId: string]: {
    q: string;
    pending: boolean;
  };
}

interface BriefingItem {
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  title: string;
  what_to_know: string;
  actions: string[];
  sources: string[];
  from_ravi: boolean;
}

interface UpcomingJob {
  job: string;
  due: string;
  note: string;
}

interface Briefing {
  headline: string;
  items: BriefingItem[];
  upcoming: UpcomingJob[];
  createdAt: number;
}

export interface VesselState {
  vesselId: string;
  vesselName: string;
  department: string;
  csv: string;
  notes: string;
  sample: boolean;
  findings: Finding[];
  qIndex: number;
  interview: InterviewEntry[];
  followUps: FollowUpState;
  briefing: Briefing | null;
  analysedAt: number | null;
  updatedAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'vessels_state.json');

function createBlankState(vesselId = 'coral-meridian', vesselName = 'MV Coral Meridian'): VesselState {
  return {
    vesselId,
    vesselName,
    department: 'Engine department',
    csv: '',
    notes: '',
    sample: false,
    findings: [],
    qIndex: 0,
    interview: [],
    followUps: {},
    briefing: null,
    analysedAt: null,
    updatedAt: Date.now(),
  };
}

let vesselStore: Record<string, VesselState> = {};

function initStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      vesselStore = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Storage] Could not load persisted file, initializing fresh store:', err);
  }
  if (!vesselStore['coral-meridian']) {
    vesselStore['coral-meridian'] = createBlankState();
  }
}

function persistStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(vesselStore, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Storage] Failed to write vessels_state.json:', err);
  }
}

initStorage();

// --- API Endpoints ---

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: "Ship's Memory Maritime Handover",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    timestamp: new Date().toISOString(),
  });
});

// List vessels
app.get('/api/vessels', (_req: Request, res: Response) => {
  const list = Object.values(vesselStore).map(v => ({
    id: v.vesselId,
    name: v.vesselName,
    department: v.department,
    hasRecords: Boolean(v.csv),
    findingsCount: v.findings.length,
    hasBriefing: Boolean(v.briefing),
  }));
  res.json({ vessels: list });
});

// Get vessel state
app.get('/api/vessels/:id/state', (req: Request, res: Response) => {
  const vesselId = req.params.id || 'coral-meridian';
  if (!vesselStore[vesselId]) {
    vesselStore[vesselId] = createBlankState(vesselId, vesselId === 'coral-meridian' ? 'MV Coral Meridian' : vesselId.toUpperCase());
    persistStore();
  }
  res.json({ state: vesselStore[vesselId] });
});

// Update vessel state
app.post('/api/vessels/:id/state', (req: Request, res: Response) => {
  const vesselId = req.params.id || 'coral-meridian';
  const rawBody = (req.body && typeof req.body === 'object') ? req.body : {};
  const current = vesselStore[vesselId] || createBlankState(vesselId);

  // Strict undefined-stripping and defensive merging
  const cleanUpdates = stripUndefined(rawBody);
  const updatedState: VesselState = {
    ...current,
    ...cleanUpdates,
    vesselId,
    updatedAt: Date.now(),
  };

  vesselStore[vesselId] = updatedState;
  persistStore();

  res.json({ success: true, state: updatedState });
});

// Reset vessel state
app.post('/api/vessels/:id/reset', (req: Request, res: Response) => {
  const vesselId = req.params.id || 'coral-meridian';
  const vesselName = vesselStore[vesselId]?.vesselName || 'MV Coral Meridian';
  vesselStore[vesselId] = createBlankState(vesselId, vesselName);
  persistStore();
  res.json({ success: true, state: vesselStore[vesselId] });
});

// 1. Office Analysis Endpoint
app.post('/api/ai/analyse', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const csv = typeof body.csv === 'string' ? body.csv.slice(0, 80000) : '';
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 30000) : '';
    const today = body.today || '16 Oct 2026';

    if (!csv.trim()) {
      res.status(400).json({ error: 'No maintenance records provided to analyze.' });
      return;
    }

    const systemInstruction = `You are an expert marine technical superintendent preparing a formal crew handover for a commercial merchant vessel engine department.
Today's operational date is ${today}.
Analyze the provided maintenance records and superintendent notes. Identify 3 to 5 critical operational or mechanical issues where the written logs are incomplete, ambiguous, or where the outgoing Chief Engineer's (Ravi) personal tactile and operational knowledge is strictly needed before departure.
Prioritize:
- Repeated repairs on the exact same equipment without root cause resolution
- Overdue maintenance jobs critical to propulsion, safety, or environmental compliance
- Temporary clamps, bypasses, or provisional fixes with missing follow-up spare orders
- Repeated alarms acknowledged without recorded corrective action
- Delayed spare parts impacting operational redundancy
- Planned overhauls that may be inappropriate based on actual running history

For each finding, construct one direct, friendly, and technically precise question for Ravi in plain English (1-2 sentences) referencing the specific record IDs.`;

    const userPrompt = `Review the ship's maintenance records and technical notes enclosed below:

<ship_maintenance_records>
${csv}
</ship_maintenance_records>

<untrusted_notes>
${notes || 'None logged.'}
</untrusted_notes>

Identify the top 3 to 5 issues requiring Ravi's handover interview.`;

    const { result, modelUsed } = await generateWithFallback(async (model, ai) => {
      const response = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: {
                      type: Type.STRING,
                      description: 'Critical, High, Medium, or Low',
                    },
                    title: {
                      type: Type.STRING,
                      description: 'Short equipment issue title',
                    },
                    summary: {
                      type: Type.STRING,
                      description: 'One sentence technical summary of what records show',
                    },
                    evidence: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'List of record IDs cited as evidence',
                    },
                    question: {
                      type: Type.STRING,
                      description: 'Friendly, specific handover question to Ravi',
                    },
                  },
                  required: ['severity', 'title', 'summary', 'evidence', 'question'],
                },
              },
            },
            required: ['findings'],
          },
        },
      });
      return response.text;
    });

    const parsed = JSON.parse(result || '{"findings":[]}');
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const sanitized = rawFindings.slice(0, 6).map((f: any, i: number) => ({
      id: `F${i + 1}`,
      severity: ['Critical', 'High', 'Medium', 'Low'].includes(f.severity) ? f.severity : 'Medium',
      title: String(f.title || 'Technical Finding'),
      summary: String(f.summary || ''),
      evidence: Array.isArray(f.evidence) ? f.evidence.map(String) : [],
      question: String(f.question || ''),
    }));

    res.json({ findings: sanitized, modelUsed });
  } catch (err: any) {
    console.error('[/api/ai/analyse error]:', err);
    res.status(500).json({ error: err.message || 'Failed to complete records analysis.' });
  }
});

// 2. Ravi Multilingual Translation & Follow-up Endpoint
app.post('/api/ai/translate-answer', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const question = typeof body.question === 'string' ? body.question : '';
    const context = typeof body.context === 'string' ? body.context : '';
    const isFollowUp = Boolean(body.isFollowUp);
    const priorContext = typeof body.priorContext === 'string' ? body.priorContext : '';

    if (!text) {
      res.status(400).json({ error: 'No answer text provided.' });
      return;
    }

    const systemInstruction = `You are a marine engineering handover translation and clarification assistant.
An outgoing Chief Engineer (Ravi) is answering a handover interview question.
He may reply in Hindi (Devanagari or Romanized), Tagalog, Marathi, Spanish, or English.
Tasks:
1. Detect and name the language of his response.
2. Faithfully translate it into clear, nautical-standard English. If already English, polish technical clarity without changing meaning.
3. ${isFollowUp ? 'Set needs_follow_up to false.' : 'Determine if one short, safety-critical follow-up question is strictly necessary. Only request a follow-up if his answer introduces an unaddressed safety hazard, omits a vital procedural step, or is dangerously ambiguous. Otherwise set needs_follow_up to false.'}`;

    const prompt = `Handover Question: ${question}
Context from Ship Records: ${context}
${priorContext ? `Previous Discussion on this equipment:\n${priorContext}` : ''}
Chief Engineer Ravi's Answer: """${text}"""`;

    const { result, modelUsed } = await generateWithFallback(async (model, ai) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              language: { type: Type.STRING },
              english: { type: Type.STRING },
              needs_follow_up: { type: Type.BOOLEAN },
              follow_up_question: { type: Type.STRING },
            },
            required: ['language', 'english', 'needs_follow_up', 'follow_up_question'],
          },
        },
      });
      return response.text;
    });

    const parsed = JSON.parse(result || '{}');
    res.json({
      language: parsed.language || 'English',
      english: parsed.english || text,
      needs_follow_up: Boolean(parsed.needs_follow_up && parsed.follow_up_question),
      follow_up_question: parsed.follow_up_question || '',
      modelUsed,
    });
  } catch (err: any) {
    console.error('[/api/ai/translate-answer error]:', err);
    res.status(500).json({ error: err.message || 'Failed to process answer.' });
  }
});

// 3. Demo Answer Generator (Role-play Ravi's Voice in Hindi / Native Language)
app.post('/api/ai/demo-draft', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const question = typeof body.question === 'string' ? body.question : '';
    const demoKnowledge = typeof body.demoKnowledge === 'string' ? body.demoKnowledge : '';

    const systemInstruction = `You are role-playing Chief Engineer Ravi, an experienced Indian chief marine engineer who has served on MV Coral Meridian for 6 months.
You are speaking casually but authoritatively to the handover system.
Write your answer in Hindi (Devanagari script), 2 to 3 short spoken sentences, deeply practical, direct, and highlighting real machinery quirks.
Draw from the facts you know. If the question is outside those facts, give a practical engineer answer based on common marine practice.
Do not include quotation marks or meta-commentary, output only Ravi's spoken words in Hindi.`;

    const prompt = `What you know about the ship's machinery:
${demoKnowledge}

Question asked: ${question}`;

    const { result, modelUsed } = await generateWithFallback(async (model, ai) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction },
      });
      return response.text;
    });

    res.json({ draft: (result || '').trim(), modelUsed });
  } catch (err: any) {
    console.error('[/api/ai/demo-draft error]:', err);
    res.status(500).json({ error: err.message || 'Failed to generate demo draft.' });
  }
});

// Audio Transcription Endpoint using Gemini with model fallback ladder
app.post('/api/ai/transcribe', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
    let rawMime = typeof body.mimeType === 'string' ? body.mimeType.split(';')[0].trim() : 'audio/webm';
    const question = typeof body.question === 'string' ? body.question : '';
    const languageHint = typeof body.languageHint === 'string' ? body.languageHint : '';

    if (!audioBase64) {
      res.status(400).json({ error: 'No audio data received.' });
      return;
    }

    const allowedTypes = ['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/aac'];
    const mimeType = allowedTypes.includes(rawMime) ? rawMime : 'audio/webm';

    const transcribeLadder = [
      'gemini-3.5-transcribe',
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
    ];

    const ai = getGenAIClient();
    if (!ai) {
      throw new Error('GEMINI_API_KEY is not configured in server environment.');
    }

    let transcribedText = '';
    let lastError: any = null;
    let modelUsed = '';

    for (const model of transcribeLadder) {
      try {
        const audioPart = {
          inlineData: {
            mimeType,
            data: audioBase64,
          },
        };
        const promptText = `Transcribe this marine engineer's spoken audio accurately.
The speaker is Chief Engineer Ravi speaking about the ship's machinery${question ? ` in response to: "${question}"` : ''}.
Language context: ${languageHint || 'Hindi, Tagalog, English, or Indian English'}.
Return the transcript faithfully in the spoken language (if Hindi, use Devanagari script; if English or Tagalog, use standard orthography).
Output ONLY the exact spoken words with no preamble, formatting, or commentary.`;

        const response = await ai.models.generateContent({
          model,
          contents: { parts: [audioPart, { text: promptText }] },
        });

        transcribedText = (response.text || '').trim();
        modelUsed = model;
        if (transcribedText) {
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[Transcription Fallback] Model ${model} failed:`, err?.message || err);
      }
    }

    if (!transcribedText && lastError) {
      throw lastError;
    }

    res.json({ text: transcribedText, modelUsed });
  } catch (err: any) {
    console.error('[/api/ai/transcribe error]:', err);
    res.status(500).json({ error: err.message || 'Audio transcription failed.' });
  }
});

// 4. Briefing Generation Endpoint
app.post('/api/ai/briefing', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const interview = typeof body.interview === 'string' ? body.interview.slice(0, 40000) : '';
    const csv = typeof body.csv === 'string' ? body.csv.slice(0, 60000) : '';
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 20000) : '';
    const today = body.today || '16 Oct 2026';

    const systemInstruction = `You are a Senior Fleet Technical Superintendent authoring an executive operational handover briefing for Jose, the incoming Chief Engineer who boards today (${today}).
Integrate Ravi's interview statements with the maintenance database and superintendent notes.
Rules:
1. Put the most safety-critical or propulsion-critical items first (severity: Critical > High > Medium).
2. Clearly distinguish between advice originating directly from Ravi's personal experience vs purely from static records.
3. If Ravi skipped an item, explicitly state that this equipment needs immediate verification with the superintendent.
4. Provide concrete, imperative action items (e.g. "Run seawater pump No. 2 max 4 hours before alternating", "Order replacement pipe section for FO line cyl 4").
5. Extract an upcoming/overdue jobs table from the records so Jose knows immediate maintenance obligations.`;

    const prompt = `RECORDS (CSV):
<ship_records>
${csv}
</ship_records>

NOTES & DISPATCHES:
<notes>
${notes || 'None'}
</notes>

RAVI'S HANDOVER INTERVIEW TRANSCRIPT:
<interview>
${interview}
</interview>`;

    const { result, modelUsed } = await generateWithFallback(async (model, ai) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: {
                type: Type.STRING,
                description: 'One crisp sentence summarizing overall engine department readiness',
              },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: { type: Type.STRING, description: 'Critical, High, Medium, or Low' },
                    title: { type: Type.STRING, description: 'Equipment or system name' },
                    what_to_know: { type: Type.STRING, description: '2 to 3 sentences explaining the condition and root cause' },
                    actions: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'List of immediate imperative actions for Jose',
                    },
                    sources: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'Cited record IDs or interview references',
                    },
                    from_ravi: {
                      type: Type.BOOLEAN,
                      description: 'True if based on Ravi insights, false if records only',
                    },
                  },
                  required: ['severity', 'title', 'what_to_know', 'actions', 'sources', 'from_ravi'],
                },
              },
              upcoming: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    job: { type: Type.STRING },
                    due: { type: Type.STRING },
                    note: { type: Type.STRING },
                  },
                  required: ['job', 'due', 'note'],
                },
              },
            },
            required: ['headline', 'items', 'upcoming'],
          },
        },
      });
      return response.text;
    });

    const parsed = JSON.parse(result || '{}');
    const briefing: Briefing = {
      headline: parsed.headline || 'Handover briefing ready for review.',
      items: Array.isArray(parsed.items) ? parsed.items : [],
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
      createdAt: Date.now(),
    };

    res.json({ briefing, modelUsed });
  } catch (err: any) {
    console.error('[/api/ai/briefing error]:', err);
    res.status(500).json({ error: err.message || 'Failed to generate briefing.' });
  }
});

// 5. Jose Grounded "Ask the Ship" Q&A Chatbot Endpoint
app.post('/api/ai/ask', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const interview = typeof body.interview === 'string' ? body.interview.slice(0, 40000) : '';
    const csv = typeof body.csv === 'string' ? body.csv.slice(0, 60000) : '';
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 20000) : '';
    const turns = Array.isArray(body.turns) ? body.turns : [];
    const today = body.today || '16 Oct 2026';

    if (!question) {
      res.status(400).json({ error: 'No question provided.' });
      return;
    }

    const systemInstruction = `You are Ship's Memory, the AI maritime intelligence system for MV Coral Meridian.
Today is ${today}. Ravi, the outgoing Chief Engineer, has signed off. Jose is the new Chief Engineer.
Answer Jose's questions STRICTLY and ONLY from the provided handover materials:
1. Ravi's translated handover interview transcript.
2. The ship's maintenance records (CSV).
3. Technical notes and office dispatches.

Rules:
- Be short, direct, and practical (2 to 5 sentences max).
- Whenever invoking Ravi's tacit knowledge, say explicitly "Ravi noted..." or "Ravi said...".
- Cite relevant record IDs in square brackets (e.g., [WO-118], [DR-31]).
- If the question cannot be answered from the provided records or interview, state clearly: "This is not recorded in the handover logs or Ravi's interview. Please verify directly with the technical superintendent."
- Do NOT make up equipment details, maker specifications, or procedures not present in the data.`;

    const contextPayload = `RECORDS (CSV):
<records>
${csv}
</records>

NOTES:
<notes>
${notes || 'None'}
</notes>

RAVI'S HANDOVER INTERVIEW (TRANSLATED):
<interview>
${interview || 'No interview recorded yet.'}
</interview>`;

    const messages = [
      { role: 'user', content: `${contextPayload}\n\nUser Question: ${question}` },
    ];

    // Append prior conversational history if provided
    if (turns.length > 0) {
      for (const t of turns.slice(-6)) {
        if (t.role === 'user' || t.role === 'assistant') {
          messages.push({ role: t.role, content: String(t.content || '') });
        }
      }
    }

    const { result, modelUsed } = await generateWithFallback(async (model, ai) => {
      const response = await ai.models.generateContent({
        model,
        contents: `${systemInstruction}\n\n${contextPayload}\n\nJose asks: "${question}"`,
      });
      return response.text;
    });

    res.json({ answer: (result || '').trim(), modelUsed });
  } catch (err: any) {
    console.error('[/api/ai/ask error]:', err);
    res.status(500).json({ error: err.message || 'Failed to answer ship inquiry.' });
  }
});

// --- Static and Dev Setup ---
async function startServer() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Ship's Memory] Server running on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
