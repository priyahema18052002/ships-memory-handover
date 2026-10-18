/**
 * Browser-side replacement for server.ts, so the app runs on Firebase Hosting
 * (free Spark plan) with no backend. Gemini is called directly from the browser
 * using VITE_GEMINI_API_KEY, and handover state is saved in localStorage.
 *
 * SECURITY: the key is visible in the built JavaScript. Restrict it in
 * Google Cloud Console > APIs & Services > Credentials (HTTP referrers +
 * Generative Language API only).
 */
import { GoogleGenAI, Type } from '@google/genai';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
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
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
  });
}

// Resilient Helper: Execute generation with model fallback ladder
async function generateWithFallback(
  generateFn: (model: string, ai: GoogleGenAI) => Promise<any>
): Promise<{ result: any; modelUsed: string }> {
  const ai = getGenAIClient();
  if (!ai) {
    throw new Error('Gemini API key missing: set VITE_GEMINI_API_KEY in .env.production and rebuild.');
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


// --- Local persistence (replaces the server's JSON file) ---
const STORE_KEY = 'ships-memory:vessels';
function createBlankState(vesselId = 'coral-meridian', vesselName = 'MV Coral Meridian') {
  return { vesselId, vesselName, department: 'Engine department', csv: '', notes: '', sample: false,
    findings: [], qIndex: 0, interview: [], followUps: {}, briefing: null, analysedAt: null, updatedAt: Date.now() };
}
function loadStore(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function saveStore(store: Record<string, any>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { console.warn('[Storage] save failed', e); }
}

const routes: Record<string, (body: any) => Promise<any>> = {};

// 1. Office Analysis Endpoint
routes['/api/ai/analyse'] = async (body: any): Promise<any> => {
  try {
    const csv = typeof body.csv === 'string' ? body.csv.slice(0, 80000) : '';
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 30000) : '';
    const today = body.today || '16 Oct 2026';

    if (!csv.trim()) {
      throw new ApiError(400, 'No maintenance records provided to analyze.');
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

    return ({ findings: sanitized, modelUsed });
  } catch (err: any) {
        throw new ApiError(500, err.message || 'Failed to complete records analysis.');
  }
};

// 2. Ravi Multilingual Translation & Follow-up Endpoint
routes['/api/ai/translate-answer'] = async (body: any): Promise<any> => {
  try {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const question = typeof body.question === 'string' ? body.question : '';
    const context = typeof body.context === 'string' ? body.context : '';
    const isFollowUp = Boolean(body.isFollowUp);
    const priorContext = typeof body.priorContext === 'string' ? body.priorContext : '';

    if (!text) {
      throw new ApiError(400, 'No answer text provided.');
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
    return ({
      language: parsed.language || 'English',
      english: parsed.english || text,
      needs_follow_up: Boolean(parsed.needs_follow_up && parsed.follow_up_question),
      follow_up_question: parsed.follow_up_question || '',
      modelUsed,
    });
  } catch (err: any) {
        throw new ApiError(500, err.message || 'Failed to process answer.');
  }
};

// 3. Demo Answer Generator (Role-play Ravi's Voice in Hindi / Native Language)
routes['/api/ai/demo-draft'] = async (body: any): Promise<any> => {
  try {
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

    return ({ draft: (result || '').trim(), modelUsed });
  } catch (err: any) {
        throw new ApiError(500, err.message || 'Failed to generate demo draft.');
  }
};

// Audio Transcription Endpoint using Gemini with model fallback ladder
routes['/api/ai/transcribe'] = async (body: any): Promise<any> => {
  try {
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
    let rawMime = typeof body.mimeType === 'string' ? body.mimeType.split(';')[0].trim() : 'audio/webm';
    const question = typeof body.question === 'string' ? body.question : '';
    const languageHint = typeof body.languageHint === 'string' ? body.languageHint : '';

    if (!audioBase64) {
      throw new ApiError(400, 'No audio data received.');
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
      throw new Error('Gemini API key missing: set VITE_GEMINI_API_KEY in .env.production and rebuild.');
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

    return ({ text: transcribedText, modelUsed });
  } catch (err: any) {
        throw new ApiError(500, err.message || 'Audio transcription failed.');
  }
};

// 4. Briefing Generation Endpoint
routes['/api/ai/briefing'] = async (body: any): Promise<any> => {
  try {
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
    const briefing = {
      headline: parsed.headline || 'Handover briefing ready for review.',
      items: Array.isArray(parsed.items) ? parsed.items : [],
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
      createdAt: Date.now(),
    };

    return ({ briefing, modelUsed });
  } catch (err: any) {
        throw new ApiError(500, err.message || 'Failed to generate briefing.');
  }
};

// 5. Jose Grounded "Ask the Ship" Q&A Chatbot Endpoint
routes['/api/ai/ask'] = async (body: any): Promise<any> => {
  try {
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const interview = typeof body.interview === 'string' ? body.interview.slice(0, 40000) : '';
    const csv = typeof body.csv === 'string' ? body.csv.slice(0, 60000) : '';
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 20000) : '';
    const turns = Array.isArray(body.turns) ? body.turns : [];
    const today = body.today || '16 Oct 2026';

    if (!question) {
      throw new ApiError(400, 'No question provided.');
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

    return ({ answer: (result || '').trim(), modelUsed });
  } catch (err: any) {
        throw new ApiError(500, err.message || 'Failed to answer ship inquiry.');
  }
};


function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Drop-in replacement for fetch('/api/...') calls. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  let body: any = {};
  try { body = init.body ? JSON.parse(String(init.body)) : {}; } catch { body = {}; }
  try {
    if (url === '/api/health') {
      return json({ status: 'ok', geminiConfigured: Boolean(getGenAIClient()) });
    }
    const vm = url.match(/^\/api\/vessels\/([^/]+)\/(state|reset)$/);
    if (vm) {
      const id = decodeURIComponent(vm[1]);
      const store = loadStore();
      const current = store[id] || createBlankState(id);
      if (vm[2] === 'reset') {
        store[id] = createBlankState(id, current.vesselName);
      } else if (method === 'POST') {
        store[id] = { ...current, ...JSON.parse(JSON.stringify(body || {})), vesselId: id, updatedAt: Date.now() };
      } else {
        store[id] = current;
        saveStore(store);
        return json({ state: current });
      }
      saveStore(store);
      return json({ success: true, state: store[id] });
    }
    const handler = routes[url];
    if (!handler) return json({ error: `Unknown endpoint ${url}` }, 404);
    return json(await handler(body));
  } catch (err: any) {
    console.error(`[${url}]`, err);
    return json({ error: err?.message || 'Request failed.' }, err instanceof ApiError ? err.status : 500);
  }
}
