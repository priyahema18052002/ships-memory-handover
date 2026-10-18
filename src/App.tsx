/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Ship,
  Anchor,
  User,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mic,
  MicOff,
  Send,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Printer,
  RotateCcw,
  FileText,
  HelpCircle,
  Database,
  Moon,
  Sun,
  ShieldAlert,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  Role,
  Finding,
  InterviewEntry,
  Briefing,
  VesselState,
  ChatMessage,
} from './types';
import {
  SAMPLE_CSV,
  SAMPLE_NOTES,
  DEMO_KNOWLEDGE,
  DEFAULT_QUESTIONS,
} from './data/sampleData';
import { parseCSV } from './utils/csvParser';
import { apiFetch } from './localApi';

const VESSEL_ID = 'coral-meridian';

function blankState(): VesselState {
  return {
    vesselId: VESSEL_ID,
    vesselName: 'MV Coral Meridian',
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

export default function App() {
  const [role, setRole] = useState<Role>('office');
  const [state, setState] = useState<VesselState>(blankState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [themeDark, setThemeDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Ravi inputs
  const [answerInput, setAnswerInput] = useState('');
  const [micLang, setMicLang] = useState('hi-IN');
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Jose Chat inputs
  const [askInput, setAskInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [isSpeakingBrief, setIsSpeakingBrief] = useState(false);

  // Sync dark class on root document
  useEffect(() => {
    if (themeDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [themeDark]);

  // Load initial state from server
  useEffect(() => {
    async function loadInitialState() {
      try {
        setLoading(true);
        const res = await apiFetch(`/api/vessels/${VESSEL_ID}/state`);
        if (res.ok) {
          const data = await res.json();
          if (data.state) {
            setState(data.state);
            if (data.state.notes) setNotesOpen(true);
          }
        }
      } catch (err) {
        console.warn('Could not load vessel state from server:', err);
      } finally {
        setLoading(false);
      }
    }
    loadInitialState();
  }, []);

  // Sync state to server with undefined-stripping
  async function persistToServer(nextState: VesselState): Promise<boolean> {
    setSaving(true);
    try {
      const sanitized = JSON.parse(JSON.stringify(nextState));
      const res = await apiFetch(`/api/vessels/${VESSEL_ID}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitized),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to persist state`);
      }
      return true;
    } catch (err: any) {
      console.error('Persistence failed:', err);
      setErrorMessage(`Failed to save vessel data: ${err.message || 'Network error'}. Click to retry.`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // --- Office Actions ---
  async function handleLoadSample() {
    setErrorMessage(null);
    const next: VesselState = {
      ...blankState(),
      csv: SAMPLE_CSV,
      notes: SAMPLE_NOTES,
      sample: true,
      updatedAt: Date.now(),
    };
    setState(next);
    setNotesOpen(true);
    setChatHistory([]);
    await persistToServer(next);
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    try {
      const text = await file.text();
      const next: VesselState = {
        ...blankState(),
        csv: text.trim(),
        notes: state.notes,
        sample: false,
        updatedAt: Date.now(),
      };
      setState(next);
      setChatHistory([]);
      await persistToServer(next);
    } catch (err: any) {
      setErrorMessage('Could not read CSV file: ' + err.message);
    }
  }

  async function handleNotesChange(newNotes: string) {
    const next = { ...state, notes: newNotes, updatedAt: Date.now() };
    setState(next);
    await persistToServer(next);
  }

  async function handleAnalyse() {
    if (!state.csv) return;
    setBusyAction('Analyzing maintenance records and logs with Gemini...');
    setErrorMessage(null);

    try {
      const res = await apiFetch('/api/ai/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: state.csv,
          notes: state.notes,
          today: '16 Oct 2026',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const findings: Finding[] = data.findings || [];

      const next: VesselState = {
        ...state,
        findings,
        qIndex: 0,
        interview: [],
        followUps: {},
        briefing: null,
        analysedAt: Date.now(),
        updatedAt: Date.now(),
      };
      setState(next);
      setChatHistory([]);
      await persistToServer(next);
    } catch (err: any) {
      setErrorMessage(`Analysis failed: ${err.message || 'Gemini service error'}. Please try again.`);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReset() {
    if (!window.confirm('Reset all maintenance records, interview responses, and briefing for MV Coral Meridian?')) {
      return;
    }
    const fresh = blankState();
    setState(fresh);
    setChatHistory([]);
    setErrorMessage(null);
    await persistToServer(fresh);
  }

  // --- Ravi Actions ---
  async function handleSubmitAnswer(textToSubmit?: string) {
    const answerText = (textToSubmit !== undefined ? textToSubmit : answerInput).trim();
    const currentFinding = state.findings[state.qIndex];
    if (!currentFinding || !answerText) return;

    const followUpState = state.followUps[currentFinding.id];
    const isFollowUp = Boolean(followUpState && followUpState.pending);
    const activeQuestion = isFollowUp ? followUpState.q : currentFinding.question;

    setBusyAction('Processing Chief Engineer answer with Gemini...');
    setErrorMessage(null);

    try {
      const priorAnswers = state.interview
        .filter(x => x.fid === currentFinding.id && !x.skipped)
        .map(x => `${x.followUp ? 'Follow-up: ' + x.followUp + '\n' : ''}Ravi (${x.language}): ${x.english}`)
        .join('\n');

      const res = await apiFetch('/api/ai/translate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: answerText,
          question: activeQuestion,
          context: `${currentFinding.summary} (${currentFinding.evidence.join(', ')})`,
          isFollowUp,
          priorContext: priorAnswers,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const newEntry: InterviewEntry = {
        fid: currentFinding.id,
        original: answerText,
        language: data.language || 'English',
        english: data.english || answerText,
        followUp: isFollowUp ? followUpState.q : undefined,
      };

      const updatedInterview = [...state.interview, newEntry];
      const updatedFollowUps = { ...state.followUps };

      let nextIndex = state.qIndex;
      if (!isFollowUp && data.needs_follow_up && data.follow_up_question) {
        updatedFollowUps[currentFinding.id] = {
          q: data.follow_up_question,
          pending: true,
        };
      } else {
        if (isFollowUp) {
          updatedFollowUps[currentFinding.id] = {
            ...followUpState,
            pending: false,
          };
        }
        nextIndex = state.qIndex + 1;
      }

      const next: VesselState = {
        ...state,
        interview: updatedInterview,
        followUps: updatedFollowUps,
        qIndex: nextIndex,
        updatedAt: Date.now(),
      };

      setState(next);
      setAnswerInput('');
      await persistToServer(next);
    } catch (err: any) {
      setErrorMessage(`Failed to submit answer: ${err.message}. Your input is preserved.`);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSkipAnswer() {
    const currentFinding = state.findings[state.qIndex];
    if (!currentFinding) return;

    const followUpState = state.followUps[currentFinding.id];
    const isFollowUp = Boolean(followUpState && followUpState.pending);

    const updatedInterview = [
      ...state.interview,
      {
        fid: currentFinding.id,
        skipped: true,
        followUp: isFollowUp ? followUpState.q : undefined,
      },
    ];

    const updatedFollowUps = { ...state.followUps };
    if (isFollowUp) {
      updatedFollowUps[currentFinding.id] = {
        ...followUpState,
        pending: false,
      };
    }

    const next: VesselState = {
      ...state,
      interview: updatedInterview,
      followUps: updatedFollowUps,
      qIndex: state.qIndex + 1,
      updatedAt: Date.now(),
    };

    setState(next);
    setAnswerInput('');
    await persistToServer(next);
  }

  async function handleDraftDemoAnswer() {
    const currentFinding = state.findings[state.qIndex];
    if (!currentFinding) return;

    const followUpState = state.followUps[currentFinding.id];
    const isFollowUp = Boolean(followUpState && followUpState.pending);
    const activeQuestion = isFollowUp ? followUpState.q : currentFinding.question;

    setBusyAction('Generating Chief Engineer Ravi voice draft...');
    try {
      const res = await apiFetch('/api/ai/demo-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: activeQuestion,
          demoKnowledge: DEMO_KNOWLEDGE,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.draft) {
        setAnswerInput(data.draft);
      }
    } catch (err: any) {
      setErrorMessage('Could not draft demo response: ' + err.message);
    } finally {
      setBusyAction(null);
    }
  }

  // Media Recording & Transcription State
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Clean up streams and timers on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  async function startRecording() {
    setErrorMessage(null);
    audioChunksRef.current = [];

    // 1. Try MediaRecorder with audio stream
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        // Determine supported audio MIME type
        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav'];
        let chosenMime = '';
        for (const m of mimeTypes) {
          if (MediaRecorder.isTypeSupported(m)) {
            chosenMime = m;
            break;
          }
        }

        const options = chosenMime ? { mimeType: chosenMime } : undefined;
        const recorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setIsRecording(false);
          setRecordingSeconds(0);

          // Stop all audio tracks
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
          }

          if (audioChunksRef.current.length === 0) return;

          const recordedBlob = new Blob(audioChunksRef.current, { type: chosenMime || 'audio/webm' });
          if (recordedBlob.size < 500) {
            // Audio too brief
            return;
          }

          await transcribeAudioBlob(recordedBlob, chosenMime || 'audio/webm');
        };

        recorder.start(250); // Slice every 250ms
        setIsRecording(true);
        setRecordingSeconds(0);

        timerIntervalRef.current = setInterval(() => {
          setRecordingSeconds(s => {
            if (s >= 60) {
              // Auto stop after 60 seconds
              stopRecording();
              return 60;
            }
            return s + 1;
          });
        }, 1000);

        return;
      } catch (err: any) {
        console.warn('getUserMedia failed, trying SpeechRecognition fallback:', err);
      }
    }

    // 2. Fallback to Web Speech Recognition if MediaRecorder is blocked or unavailable
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const rec = new SpeechRecognition();
        rec.lang = micLang;
        rec.continuous = false;
        rec.interimResults = true;
        recognitionRef.current = rec;

        rec.onstart = () => setIsRecording(true);
        rec.onresult = (event: any) => {
          let transcript = '';
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          if (transcript.trim()) {
            setAnswerInput(prev => (prev ? prev + ' ' : '') + transcript);
          }
        };
        rec.onerror = (e: any) => {
          console.warn('Speech error:', e);
          setIsRecording(false);
          setErrorMessage('Speech recognition stopped: ' + (e.error || 'Check microphone permissions.'));
        };
        rec.onend = () => setIsRecording(false);

        rec.start();
        return;
      } catch (err: any) {
        console.warn('SpeechRecognition start failed:', err);
      }
    }

    setErrorMessage(
      'Microphone access is not available in this browser or permission was denied. Please allow microphone in your browser address bar, or use "Demo: Draft Ravi Voice in Hindi" to test.'
    );
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.warn('Error stopping MediaRecorder:', e);
      }
    } else if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn('Error stopping SpeechRecognition:', e);
      }
      setIsRecording(false);
    }
  }

  function cancelRecording() {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
  }

  async function transcribeAudioBlob(blob: Blob, mimeType: string) {
    setIsTranscribing(true);
    setBusyAction('Transcribing your spoken voice with Gemini AI...');
    setErrorMessage(null);

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      const currentFinding = state.findings[state.qIndex];
      const langNames: Record<string, string> = {
        'hi-IN': 'Hindi (Devanagari)',
        'en-IN': 'English (India)',
        'en-US': 'English (US)',
        'fil-PH': 'Filipino / Tagalog',
      };

      const res = await apiFetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType,
          question: currentFinding ? currentFinding.question : '',
          languageHint: langNames[micLang] || 'Hindi or English',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.text) {
        setAnswerInput(prev => (prev ? prev + ' ' : '') + data.text);
      } else {
        setErrorMessage('No spoken words were detected in the audio. Please try speaking closer to the microphone.');
      }
    } catch (err: any) {
      console.error('Transcription error:', err);
      setErrorMessage(`Transcription failed: ${err.message || 'Server error'}. You can type your answer.`);
    } finally {
      setIsTranscribing(false);
      setBusyAction(null);
    }
  }

  function toggleSpeechRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  async function handleCreateBriefing() {
    setBusyAction('Synthesizing executive briefing for Incoming Chief Engineer Jose...');
    setErrorMessage(null);

    try {
      const transcript = state.findings
        .map(f => {
          const answers = state.interview.filter(x => x.fid === f.id);
          const lines = answers
            .map(a =>
              a.skipped
                ? `${a.followUp ? 'Follow-up: ' + a.followUp + '\n' : ''}Ravi: [Skipped by Chief Engineer]`
                : `${a.followUp ? 'Follow-up: ' + a.followUp + '\n' : ''}Ravi (${a.language}, translated): ${a.english}`
            )
            .join('\n');
          return `[${f.severity}] ${f.title}\nRecords: ${f.summary} (${f.evidence.join(', ')})\nQuestion Asked: ${f.question}\n${lines || 'Ravi: (No response logged)'}`;
        })
        .join('\n\n');

      const res = await apiFetch('/api/ai/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interview: transcript,
          csv: state.csv,
          notes: state.notes,
          today: '16 Oct 2026',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const next: VesselState = {
        ...state,
        briefing: data.briefing,
        updatedAt: Date.now(),
      };

      setState(next);
      await persistToServer(next);
    } catch (err: any) {
      setErrorMessage(`Failed to create briefing: ${err.message}. Please retry.`);
    } finally {
      setBusyAction(null);
    }
  }

  // --- Jose Actions ---
  async function handleAskQuestion(overrideText?: string) {
    const q = (overrideText || askInput).trim();
    if (!q || isAsking) return;

    const userMsg: ChatMessage = {
      id: 'msg-' + Date.now(),
      role: 'user',
      sender: 'Jose (Chief Engineer)',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatHistory(prev => [...prev, userMsg]);
    setAskInput('');
    setIsAsking(true);
    setErrorMessage(null);

    try {
      const interviewTranscript = state.interview
        .filter(x => !x.skipped)
        .map(x => {
          const f = state.findings.find(y => y.id === x.fid);
          return `Regarding "${f?.title}": ${x.followUp ? '(Follow-up) ' : ''}Ravi stated: ${x.english}`;
        })
        .join('\n');

      const res = await apiFetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          interview: interviewTranscript,
          csv: state.csv,
          notes: state.notes,
          turns: chatHistory.map(m => ({ role: m.role, content: m.text })),
          today: '16 Oct 2026',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        sender: "Ship's Memory",
        text: data.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setChatHistory(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setErrorMessage(`Inquiry failed: ${err.message}`);
    } finally {
      setIsAsking(false);
    }
  }

  function handleReadBriefingAloud() {
    if (!('speechSynthesis' in window)) {
      setErrorMessage('Speech synthesis is not supported on this browser.');
      return;
    }
    if (isSpeakingBrief) {
      window.speechSynthesis.cancel();
      setIsSpeakingBrief(false);
      return;
    }
    if (!state.briefing) return;

    const textToRead = `Handover briefing for Jose. ${state.briefing.headline}. ` +
      state.briefing.items
        .map((it, idx) => `Priority ${idx + 1}, ${it.severity} risk: ${it.title}. ${it.what_to_know}. Actions: ${it.actions.join('. ')}`)
        .join('. ');

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 1.0;
    utterance.onend = () => setIsSpeakingBrief(false);
    utterance.onerror = () => setIsSpeakingBrief(false);

    setIsSpeakingBrief(true);
    window.speechSynthesis.speak(utterance);
  }

  // Parse CSV records for display
  const parsedRecords = parseCSV(state.csv);
  const csvHeaders = parsedRecords[0] || [];
  const csvRows = parsedRecords.slice(1);
  const statusColumnIdx = csvHeaders.findIndex(h => /status/i.test(h));

  // Compute tracker progress
  const answeredCount = new Set(state.interview.filter(x => !x.skipped).map(x => x.fid)).size;
  const isInterviewDone = state.findings.length > 0 && state.qIndex >= state.findings.length;

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-200">
      {/* Top Maritime Masthead */}
      <header className="bg-[#14424C] dark:bg-[#0c2228] text-[#F6F8F8] sticky top-0 z-30 shadow-md border-b border-[#235864]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#235864] rounded-lg shadow-inner">
              <Ship className="w-6 h-6 text-[#E3A208]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight font-condensed uppercase leading-none">
                  Ship's Memory
                </h1>
                <span className="text-xs px-2 py-0.5 rounded bg-[#E3A208] text-[#17232A] font-bold uppercase tracking-wider">
                  Handover
                </span>
              </div>
              <p className="text-xs text-[#9bbcc4] flex items-center gap-1.5 mt-0.5">
                <Anchor className="w-3 h-3 text-[#E3A208]" />
                {state.vesselName} · {state.department}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Role Switcher */}
            <nav className="flex bg-[#0b2930] p-1 rounded-lg border border-[#235864]" role="tablist">
              <button
                type="button"
                onClick={() => setRole('office')}
                className={`px-3 py-1.5 rounded text-left transition-all text-xs sm:text-sm font-medium ${
                  role === 'office'
                    ? 'bg-[#F6F8F8] text-[#14424C] shadow font-bold'
                    : 'text-[#9bbcc4] hover:text-[#F6F8F8]'
                }`}
              >
                <span className="block leading-tight">Anita</span>
                <span className="text-[10px] opacity-80 block">Superintendent</span>
              </button>
              <button
                type="button"
                onClick={() => setRole('ravi')}
                className={`px-3 py-1.5 rounded text-left transition-all text-xs sm:text-sm font-medium ${
                  role === 'ravi'
                    ? 'bg-[#F6F8F8] text-[#14424C] shadow font-bold'
                    : 'text-[#9bbcc4] hover:text-[#F6F8F8]'
                }`}
              >
                <span className="block leading-tight">Ravi</span>
                <span className="text-[10px] opacity-80 block">Chief Eng (Leaving)</span>
              </button>
              <button
                type="button"
                onClick={() => setRole('jose')}
                className={`px-3 py-1.5 rounded text-left transition-all text-xs sm:text-sm font-medium ${
                  role === 'jose'
                    ? 'bg-[#F6F8F8] text-[#14424C] shadow font-bold'
                    : 'text-[#9bbcc4] hover:text-[#F6F8F8]'
                }`}
              >
                <span className="block leading-tight">Jose</span>
                <span className="text-[10px] opacity-80 block">Chief Eng (Joining)</span>
              </button>
            </nav>

            {/* Dark Mode Toggle */}
            <button
              onClick={() => setThemeDark(!themeDark)}
              title={themeDark ? 'Switch to daylight theme' : 'Switch to night bridge theme'}
              className="p-2 rounded-lg bg-[#0b2930] hover:bg-[#1a3f47] text-[#9bbcc4] hover:text-white border border-[#235864] transition-colors"
            >
              {themeDark ? <Sun className="w-4 h-4 text-[#F0B83A]" /> : <Moon className="w-4 h-4 text-[#9bbcc4]" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Wrap */}
      <main className="max-w-6xl w-full mx-auto px-4 py-6 flex-1 flex flex-col gap-5">
        {/* Error notification banner with retry */}
        {errorMessage && (
          <div className="bg-[#A8432B]/10 border-l-4 border-[#A8432B] text-[#A8432B] dark:text-[#E07B60] p-3 rounded text-sm flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-xs underline hover:opacity-80 ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Global Pipeline Progress Bar */}
        <section aria-label="Handover progress" className="grid grid-cols-2 sm:grid-cols-4 bg-[#F6F8F8] dark:bg-[#16242A] border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg overflow-hidden shadow-sm divide-x divide-[#C5CDD1] dark:divide-[#2A3C43]">
          <div className={`p-3 text-xs ${state.csv ? 'bg-[#14424C]/10 dark:bg-[#5FA6B4]/15' : ''}`}>
            <span className="text-[#56656D] dark:text-[#94A4AB] block">1. Ship Logs</span>
            <span className="font-bold font-condensed text-base text-[#17232A] dark:text-[#E2E9EB] flex items-center gap-1">
              Records Loaded {state.csv && <CheckCircle2 className="w-4 h-4 text-[#14424C] dark:text-[#5FA6B4]" />}
            </span>
            <span className="text-[11px] text-[#56656D] dark:text-[#94A4AB]">
              {state.csv ? `${csvRows.length} items logged` : 'Waiting for Office'}
            </span>
          </div>

          <div className={`p-3 text-xs ${state.findings.length > 0 ? 'bg-[#14424C]/10 dark:bg-[#5FA6B4]/15' : ''}`}>
            <span className="text-[#56656D] dark:text-[#94A4AB] block">2. Analysis</span>
            <span className="font-bold font-condensed text-base text-[#17232A] dark:text-[#E2E9EB] flex items-center gap-1">
              Questions Prepared {state.findings.length > 0 && <CheckCircle2 className="w-4 h-4 text-[#14424C] dark:text-[#5FA6B4]" />}
            </span>
            <span className="text-[11px] text-[#56656D] dark:text-[#94A4AB]">
              {state.findings.length > 0 ? `${state.findings.length} targets identified` : 'Pending analysis'}
            </span>
          </div>

          <div className={`p-3 text-xs ${isInterviewDone ? 'bg-[#14424C]/10 dark:bg-[#5FA6B4]/15' : ''}`}>
            <span className="text-[#56656D] dark:text-[#94A4AB] block">3. Knowledge Transfer</span>
            <span className="font-bold font-condensed text-base text-[#17232A] dark:text-[#E2E9EB] flex items-center gap-1">
              Interview Complete {isInterviewDone && <CheckCircle2 className="w-4 h-4 text-[#14424C] dark:text-[#5FA6B4]" />}
            </span>
            <span className="text-[11px] text-[#56656D] dark:text-[#94A4AB]">
              {state.findings.length > 0
                ? `${answeredCount} of ${state.findings.length} answered`
                : 'Awaiting interview'}
            </span>
          </div>

          <div className={`p-3 text-xs ${state.briefing ? 'bg-[#14424C]/10 dark:bg-[#5FA6B4]/15' : ''}`}>
            <span className="text-[#56656D] dark:text-[#94A4AB] block">4. Handover Document</span>
            <span className="font-bold font-condensed text-base text-[#17232A] dark:text-[#E2E9EB] flex items-center gap-1">
              Briefing Ready {state.briefing && <CheckCircle2 className="w-4 h-4 text-[#14424C] dark:text-[#5FA6B4]" />}
            </span>
            <span className="text-[11px] text-[#56656D] dark:text-[#94A4AB]">
              {state.briefing ? 'Available to Jose' : 'Not generated'}
            </span>
          </div>
        </section>

        {/* Global Loading / Busy state indicator */}
        {busyAction && (
          <div className="bg-[#14424C] text-[#F6F8F8] px-4 py-2.5 rounded-lg text-sm flex items-center gap-3 shadow animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-[#E3A208]" />
            <span className="font-medium">{busyAction}</span>
          </div>
        )}

        {/* ============================================================== */}
        {/* ROLE 1: ANITA (SUPERINTENDENT / OFFICE) */}
        {/* ============================================================== */}
        {role === 'office' && (
          <div className="flex flex-col gap-6">
            <div className="bg-[#F6F8F8] dark:bg-[#16242A] border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#C5CDD1] dark:border-[#2A3C43] pb-3 mb-4">
                <div>
                  <h2 className="text-2xl font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB]">
                    Prepare Chief Engineer Ravi's Handover
                  </h2>
                  <p className="text-sm text-[#56656D] dark:text-[#94A4AB]">
                    Upload raw Planned Maintenance System (PMS) work orders, defect reports, and superintendent correspondence.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLoadSample}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-[#EDF1F2] dark:bg-[#1C2D34] hover:bg-[#C5CDD1] dark:hover:bg-[#2A3C43] text-[#17232A] dark:text-[#E2E9EB] border border-[#C5CDD1] dark:border-[#2A3C43] transition-colors flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#E3A208]" />
                    Load Sample Ship Data
                  </button>
                  <label className="px-3 py-1.5 rounded text-xs font-semibold bg-[#14424C] hover:bg-[#1c5663] text-white cursor-pointer transition-colors flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-[#E3A208]" />
                    Upload PMS CSV
                    <input
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      onChange={handleCsvUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Records preview */}
              {state.csv ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#56656D] dark:text-[#94A4AB]">
                      Loaded Records ({csvRows.length} entries)
                    </span>
                    <span className="text-xs text-[#56656D] dark:text-[#94A4AB]">
                      Scroll horizontally for remarks & due dates
                    </span>
                  </div>
                  <div className="border border-[#C5CDD1] dark:border-[#2A3C43] rounded max-h-64 overflow-y-auto overflow-x-auto bg-white dark:bg-[#0E191E]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#EDF1F2] dark:bg-[#1C2D34] sticky top-0 text-[#56656D] dark:text-[#94A4AB] border-b border-[#C5CDD1] dark:border-[#2A3C43]">
                        <tr>
                          {csvHeaders.map((header, idx) => (
                            <th key={idx} className="p-2 font-semibold whitespace-nowrap">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#C5CDD1] dark:divide-[#2A3C43]">
                        {csvRows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-[#F6F8F8] dark:hover:bg-[#16242A]">
                            {row.map((cell, cIdx) => {
                              const isId = cIdx === 0;
                              const isStatus = cIdx === statusColumnIdx;
                              let statusCls = '';
                              if (isStatus) {
                                if (/overdue/i.test(cell)) statusCls = 'text-[#A8432B] dark:text-[#E07B60] font-bold';
                                else if (/open/i.test(cell)) statusCls = 'text-[#E3A208] dark:text-[#F0B83A] font-bold';
                                else if (/completed/i.test(cell)) statusCls = 'text-[#14424C] dark:text-[#5FA6B4] font-semibold';
                              }
                              return (
                                <td
                                  key={cIdx}
                                  className={`p-2 whitespace-nowrap ${isId ? 'font-mono font-bold text-[#14424C] dark:text-[#5FA6B4]' : ''} ${statusCls}`}
                                >
                                  {cell || '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-8 text-center text-[#56656D] dark:text-[#94A4AB] mb-4">
                  <Database className="w-8 h-8 mx-auto mb-2 text-[#C5CDD1] dark:text-[#2A3C43]" />
                  <p className="font-medium text-sm">No ship records currently loaded</p>
                  <p className="text-xs mt-1">Load the sample data or upload a maintenance CSV export to begin.</p>
                </div>
              )}

              {/* Superintendent Notes Collapsible */}
              <div className="mb-4 border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg bg-[#EDF1F2]/50 dark:bg-[#1C2D34]/50">
                <button
                  type="button"
                  onClick={() => setNotesOpen(!notesOpen)}
                  className="w-full flex items-center justify-between p-3 text-xs font-semibold text-[#17232A] dark:text-[#E2E9EB]"
                >
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-[#14424C] dark:text-[#5FA6B4]" />
                    Superintendent Dispatches & Email Log (Optional Context)
                  </span>
                  {notesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {notesOpen && (
                  <div className="p-3 pt-0">
                    <textarea
                      value={state.notes}
                      onChange={e => handleNotesChange(e.target.value)}
                      placeholder="Paste messages between ship management and chief engineer, port state control warnings, or spare parts delay alerts..."
                      className="w-full h-24 p-2 text-xs rounded border border-[#C5CDD1] dark:border-[#2A3C43] bg-white dark:bg-[#0E191E] text-[#17232A] dark:text-[#E2E9EB] focus:outline-none focus:ring-2 focus:ring-[#14424C]"
                    />
                  </div>
                )}
              </div>

              {/* Analyse Button */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  disabled={!state.csv || Boolean(busyAction)}
                  onClick={handleAnalyse}
                  className="px-4 py-2 rounded text-sm font-bold bg-[#14424C] hover:bg-[#1c5663] text-[#F6F8F8] disabled:opacity-50 disabled:cursor-not-allowed shadow transition-all flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-[#E3A208]" />
                  Find What to Ask Ravi (Gemini AI)
                </button>
                {state.findings.length > 0 && (
                  <span className="text-xs font-medium text-[#14424C] dark:text-[#5FA6B4]">
                    ✓ Found {state.findings.length} critical issues requiring Ravi's handover interview.
                  </span>
                )}
              </div>

              {/* Findings Section */}
              {state.findings.length > 0 && (
                <div className="mt-6 flex flex-col gap-3">
                  <h3 className="text-lg font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB]">
                    Identified Handover Inquiry Targets
                  </h3>
                  <div className="grid gap-3">
                    {state.findings.map(finding => {
                      let borderCls = 'border-l-[#14424C]';
                      let badgeCls = 'bg-[#14424C] text-white';
                      if (finding.severity === 'Critical') {
                        borderCls = 'border-l-[#A8432B] dark:border-l-[#E07B60]';
                        badgeCls = 'bg-[#A8432B] dark:bg-[#E07B60] text-white';
                      } else if (finding.severity === 'High') {
                        borderCls = 'border-l-[#E3A208] dark:border-l-[#F0B83A]';
                        badgeCls = 'bg-[#E3A208] dark:bg-[#F0B83A] text-[#17232A]';
                      }
                      return (
                        <div
                          key={finding.id}
                          className={`p-4 rounded border border-[#C5CDD1] dark:border-[#2A3C43] border-l-4 ${borderCls} bg-white dark:bg-[#0E191E] shadow-sm`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${badgeCls}`}>
                              {finding.severity}
                            </span>
                            <span className="text-xs text-[#56656D] dark:text-[#94A4AB] font-mono">
                              Evidence: {finding.evidence.join(', ') || 'Maintenance logs'}
                            </span>
                          </div>
                          <h4 className="text-base font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB]">
                            {finding.title}
                          </h4>
                          <p className="text-xs text-[#56656D] dark:text-[#94A4AB] mt-1">
                            {finding.summary}
                          </p>
                          <div className="mt-3 p-2.5 rounded bg-[#EDF1F2] dark:bg-[#1C2D34] border border-[#C5CDD1] dark:border-[#2A3C43]">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#14424C] dark:text-[#5FA6B4] block mb-0.5">
                              Generated Question for Ravi:
                            </span>
                            <p className="text-sm italic text-[#17232A] dark:text-[#E2E9EB]">
                              "{finding.question}"
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 p-3 bg-[#14424C]/10 dark:bg-[#5FA6B4]/15 rounded flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#14424C] dark:text-[#5FA6B4]">
                      Interview is prepared for Chief Engineer Ravi.
                    </span>
                    <button
                      onClick={() => setRole('ravi')}
                      className="px-3 py-1 rounded text-xs font-bold bg-[#14424C] text-white hover:bg-[#1c5663]"
                    >
                      Switch to Ravi View →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Handover Status & Reset Card */}
            <div className="bg-[#F6F8F8] dark:bg-[#16242A] border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB]">
                  Ship Registry Data Management
                </h3>
                <p className="text-xs text-[#56656D] dark:text-[#94A4AB]">
                  Vessel: {state.vesselName} · State stored in persistent registry
                </p>
              </div>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 rounded text-xs font-semibold text-[#A8432B] dark:text-[#E07B60] hover:bg-[#A8432B]/10 border border-[#A8432B]/30 flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Vessel Handover
              </button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ROLE 2: RAVI (OUTGOING CHIEF ENGINEER) */}
        {/* ============================================================== */}
        {role === 'ravi' && (
          <div className="flex flex-col gap-6">
            <div className="bg-[#F6F8F8] dark:bg-[#16242A] border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-6 shadow-sm">
              <div className="border-b border-[#C5CDD1] dark:border-[#2A3C43] pb-3 mb-4">
                <h2 className="text-2xl font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB]">
                  Chief Engineer Ravi's Handover Interview
                </h2>
                <p className="text-sm text-[#56656D] dark:text-[#94A4AB]">
                  Answer the targeted questions below in any language (Hindi, Tagalog, English, Marathi, etc.). Gemini AI will translate and clarify your insights for Jose.
                </p>
              </div>

              {state.findings.length === 0 ? (
                <div className="border border-dashed border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-8 text-center text-[#56656D] dark:text-[#94A4AB]">
                  <HelpCircle className="w-8 h-8 mx-auto mb-2 text-[#C5CDD1] dark:text-[#2A3C43]" />
                  <p className="font-semibold text-sm">No handover questions prepared yet</p>
                  <p className="text-xs mt-1">
                    Superintendent Anita has not analyzed the records yet.
                  </p>
                  <button
                    onClick={() => setRole('office')}
                    className="mt-3 px-3 py-1.5 rounded text-xs font-bold bg-[#14424C] text-white hover:bg-[#1c5663]"
                  >
                    Go to Anita's View
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Interview Chat Log */}
                  <div className="flex flex-col gap-3">
                    {/* Welcome Greeting */}
                    <div className="p-3.5 rounded-lg bg-[#EDF1F2] dark:bg-[#1C2D34] border border-[#C5CDD1] dark:border-[#2A3C43] max-w-xl self-start">
                      <div className="text-[11px] font-bold text-[#14424C] dark:text-[#5FA6B4] uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Ship className="w-3.5 h-3.5" /> Ship's Memory
                      </div>
                      <p className="text-sm text-[#17232A] dark:text-[#E2E9EB]">
                        Hello Chief Ravi. I studied {csvRows.length} maintenance records from your tour of duty on MV Coral Meridian. I have {state.findings.length} questions where only your real experience can guide Jose. Please answer candidly in your preferred language.
                      </p>
                    </div>

                    {/* Render questions and answers up to current index */}
                    {state.findings.slice(0, state.qIndex + 1).map((finding, idx) => {
                      const answersForThis = state.interview.filter(x => x.fid === finding.id);
                      const followUpObj = state.followUps[finding.id];

                      return (
                        <div key={finding.id} className="flex flex-col gap-2.5">
                          {/* Question Bubble */}
                          <div className="p-4 rounded-lg bg-[#EDF1F2] dark:bg-[#1C2D34] border border-[#C5CDD1] dark:border-[#2A3C43] max-w-2xl self-start shadow-sm">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[11px] font-bold text-[#14424C] dark:text-[#5FA6B4] uppercase tracking-wider">
                                Question {idx + 1} of {state.findings.length} · {finding.title}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-[#14424C]/10 dark:bg-[#5FA6B4]/20 text-[#14424C] dark:text-[#5FA6B4]">
                                {finding.severity}
                              </span>
                            </div>
                            <p className="text-sm font-semibold text-[#17232A] dark:text-[#E2E9EB]">
                              {finding.question}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {finding.evidence.map(ev => (
                                <span
                                  key={ev}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-[#0E191E] border border-[#C5CDD1] dark:border-[#2A3C43] text-[#56656D] dark:text-[#94A4AB] font-mono"
                                >
                                  {ev}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Ravi's Answers */}
                          {answersForThis.map((ans, aIdx) => (
                            <div
                              key={aIdx}
                              className="p-3.5 rounded-lg bg-[#14424C] text-[#F6F8F8] max-w-xl self-end shadow-sm"
                            >
                              <div className="text-[11px] font-bold opacity-80 uppercase tracking-wider mb-1 flex items-center justify-between">
                                <span>Chief Ravi</span>
                                {ans.language && ans.language.toLowerCase() !== 'english' && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/20">
                                    {ans.language}
                                  </span>
                                )}
                              </div>
                              {ans.skipped ? (
                                <p className="text-sm italic opacity-75">[Skipped by Chief Engineer]</p>
                              ) : (
                                <div>
                                  <p className="text-sm font-devanagari">{ans.original}</p>
                                  {ans.language && ans.language.toLowerCase() !== 'english' && (
                                    <div className="mt-2 pt-2 border-t border-white/20 text-xs text-[#E2E9EB]">
                                      <span className="text-[10px] uppercase tracking-wider opacity-75 block font-bold">
                                        Nautical English Translation:
                                      </span>
                                      {ans.english}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Follow-up Question if pending */}
                          {followUpObj && followUpObj.pending && (
                            <div className="p-3.5 rounded-lg bg-[#E3A208]/15 dark:bg-[#F0B83A]/15 border-l-4 border-[#E3A208] dark:border-[#F0B83A] max-w-xl self-start">
                              <span className="text-[10px] font-bold text-[#E3A208] dark:text-[#F0B83A] uppercase tracking-wider block">
                                Urgent Safety Clarification Follow-up
                              </span>
                              <p className="text-sm font-semibold text-[#17232A] dark:text-[#E2E9EB] mt-0.5">
                                {followUpObj.q}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Completion message */}
                    {isInterviewDone && (
                      <div className="p-4 rounded-lg bg-[#14424C]/10 dark:bg-[#5FA6B4]/15 border border-[#14424C]/30 text-[#14424C] dark:text-[#5FA6B4] max-w-xl self-start">
                        <p className="font-bold font-condensed text-base">All questions answered!</p>
                        <p className="text-xs mt-1">
                          Thank you Chief Ravi. Your domain knowledge will ensure Jose steps into his first watch fully prepared. Click below to generate Jose's consolidated briefing.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Input Box (When questions remain) */}
                  {!isInterviewDone && (
                    <div className="mt-4 pt-4 border-t border-[#C5CDD1] dark:border-[#2A3C43]">
                      <label className="text-xs font-semibold text-[#56656D] dark:text-[#94A4AB] block mb-1.5">
                        Your Answer (Speak or type in Hindi, Tagalog, English, etc.):
                      </label>
                      <textarea
                        value={answerInput}
                        onChange={e => setAnswerInput(e.target.value)}
                        placeholder="e.g. SW pump No. 2: shaft sleeve is worn out, new seals will not hold. Run max 4 hours then alternate with pump 3..."
                        className="w-full h-24 p-3 rounded text-sm border border-[#C5CDD1] dark:border-[#2A3C43] bg-white dark:bg-[#0E191E] text-[#17232A] dark:text-[#E2E9EB] focus:ring-2 focus:ring-[#14424C] focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSubmitAnswer()}
                            disabled={!answerInput.trim() || Boolean(busyAction)}
                            className="px-4 py-2 rounded text-xs font-bold bg-[#14424C] hover:bg-[#1c5663] text-white disabled:opacity-50 flex items-center gap-1.5 shadow"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Send Answer
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={toggleSpeechRecording}
                              disabled={isTranscribing}
                              className={`px-3 py-2 rounded text-xs font-semibold border flex items-center gap-1.5 transition-all shadow-sm ${
                                isRecording
                                  ? 'bg-[#A8432B] text-white border-[#A8432B] animate-pulse ring-2 ring-[#A8432B]/40'
                                  : 'bg-[#EDF1F2] dark:bg-[#1C2D34] text-[#17232A] dark:text-[#E2E9EB] border-[#C5CDD1] dark:border-[#2A3C43] hover:bg-[#C5CDD1] dark:hover:bg-[#2A3C43]'
                              }`}
                              title={isRecording ? 'Click to finish speaking and transcribe with Gemini' : 'Click to speak your answer'}
                            >
                              {isTranscribing ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3A208]" />
                                  <span>Transcribing...</span>
                                </>
                              ) : isRecording ? (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                                  <MicOff className="w-3.5 h-3.5" />
                                  <span>Stop & Transcribe (0:{recordingSeconds < 10 ? `0${recordingSeconds}` : recordingSeconds})</span>
                                </>
                              ) : (
                                <>
                                  <Mic className="w-3.5 h-3.5 text-[#14424C] dark:text-[#5FA6B4]" />
                                  <span>Speak</span>
                                </>
                              )}
                            </button>

                            {isRecording && (
                              <button
                                onClick={cancelRecording}
                                className="px-2 py-2 rounded text-xs text-[#56656D] dark:text-[#94A4AB] hover:text-[#A8432B] transition-colors"
                                title="Cancel recording without transcribing"
                              >
                                Cancel
                              </button>
                            )}
                          </div>

                          <select
                            value={micLang}
                            onChange={e => setMicLang(e.target.value)}
                            aria-label="Speech Language"
                            disabled={isRecording || isTranscribing}
                            className="text-xs p-1.5 rounded border border-[#C5CDD1] dark:border-[#2A3C43] bg-white dark:bg-[#0E191E] text-[#17232A] dark:text-[#E2E9EB]"
                          >
                            <option value="hi-IN">Hindi (India)</option>
                            <option value="en-IN">English (India)</option>
                            <option value="en-US">English (US)</option>
                            <option value="fil-PH">Filipino / Tagalog</option>
                          </select>
                          <button
                            onClick={handleSkipAnswer}
                            disabled={Boolean(busyAction) || isRecording || isTranscribing}
                            className="px-3 py-2 rounded text-xs font-semibold text-[#56656D] dark:text-[#94A4AB] hover:bg-[#EDF1F2] dark:hover:bg-[#1C2D34] flex items-center gap-1"
                          >
                            <SkipForward className="w-3.5 h-3.5" />
                            Skip
                          </button>
                        </div>

                        {/* Demo knowledge draft button */}
                        {state.sample && (
                          <button
                            onClick={handleDraftDemoAnswer}
                            disabled={Boolean(busyAction)}
                            className="px-3 py-1.5 rounded text-xs font-semibold bg-[#E3A208]/20 text-[#17232A] dark:text-[#F0B83A] border border-[#E3A208]/40 hover:bg-[#E3A208]/30 flex items-center gap-1"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Demo: Draft Ravi Voice in Hindi
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Finish Button */}
                  {isInterviewDone && !state.briefing && (
                    <div className="mt-4 pt-4 border-t border-[#C5CDD1] dark:border-[#2A3C43] flex items-center justify-between">
                      <button
                        onClick={handleCreateBriefing}
                        disabled={Boolean(busyAction)}
                        className="px-5 py-2.5 rounded font-bold font-condensed text-base bg-[#E3A208] hover:bg-[#caa207] text-[#17232A] shadow-md flex items-center gap-2 transition-transform active:scale-95"
                      >
                        <Sparkles className="w-4 h-4" />
                        Finish Handover & Generate Jose's Briefing
                      </button>
                    </div>
                  )}

                  {state.briefing && (
                    <div className="mt-4 pt-4 border-t border-[#C5CDD1] dark:border-[#2A3C43] flex items-center justify-between">
                      <span className="text-xs text-[#14424C] dark:text-[#5FA6B4] font-semibold">
                        ✓ Briefing generated and ready for incoming Chief Engineer Jose.
                      </span>
                      <button
                        onClick={() => setRole('jose')}
                        className="px-4 py-2 rounded text-xs font-bold bg-[#14424C] text-white hover:bg-[#1c5663]"
                      >
                        View Jose's Briefing →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ROLE 3: JOSE (INCOMING CHIEF ENGINEER) */}
        {/* ============================================================== */}
        {role === 'jose' && (
          <div className="flex flex-col gap-6">
            {!state.briefing ? (
              <div className="bg-[#F6F8F8] dark:bg-[#16242A] border border-dashed border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-10 text-center text-[#56656D] dark:text-[#94A4AB]">
                <Ship className="w-10 h-10 mx-auto mb-3 text-[#C5CDD1] dark:text-[#2A3C43]" />
                <h3 className="text-xl font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB]">
                  Briefing Not Yet Finalized
                </h3>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  Chief Engineer Ravi has not finished answering the handover interview yet. Once the interview is complete and the briefing synthesized, your prioritized checklist and machinery Q&A will appear here.
                </p>
                <button
                  onClick={() => setRole(state.findings.length > 0 ? 'ravi' : 'office')}
                  className="mt-4 px-4 py-2 rounded text-xs font-bold bg-[#14424C] text-white hover:bg-[#1c5663]"
                >
                  {state.findings.length > 0 ? "Go to Ravi's Interview" : "Go to Anita's Preparation"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {/* Executive Briefing Card */}
                <div className="bg-[#F6F8F8] dark:bg-[#16242A] border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-6 shadow-sm">
                  {/* Briefing Header Banner */}
                  <div className="bg-[#14424C] text-[#F6F8F8] p-5 rounded-lg mb-6 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Anchor className="w-5 h-5 text-[#E3A208]" />
                        <h2 className="text-2xl font-bold font-condensed uppercase tracking-wide">
                          Welcome Aboard, Chief Jose
                        </h2>
                      </div>
                      <p className="text-sm text-[#d4e4e8] max-w-2xl">
                        {state.briefing.headline}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleReadBriefingAloud}
                        className="px-3 py-1.5 rounded text-xs font-semibold bg-[#235864] hover:bg-[#2f6f7e] text-white flex items-center gap-1.5 transition-colors"
                        title="Listen to briefing readout"
                      >
                        {isSpeakingBrief ? <VolumeX className="w-3.5 h-3.5 text-[#E3A208]" /> : <Volume2 className="w-3.5 h-3.5 text-[#E3A208]" />}
                        {isSpeakingBrief ? 'Stop Audio' : 'Audio Readout'}
                      </button>
                      <button
                        onClick={() => window.print()}
                        className="px-3 py-1.5 rounded text-xs font-semibold bg-[#235864] hover:bg-[#2f6f7e] text-white flex items-center gap-1.5 transition-colors"
                        title="Print executive briefing for Engine Control Room"
                      >
                        <Printer className="w-3.5 h-3.5 text-[#E3A208]" />
                        Print ECR Sheet
                      </button>
                    </div>
                  </div>

                  {/* Prioritized Handover Items */}
                  <div className="flex flex-col divide-y divide-[#C5CDD1] dark:divide-[#2A3C43]">
                    {state.briefing.items.map((item, idx) => {
                      let sevBadge = 'bg-[#14424C] text-white';
                      let numCls = 'text-[#14424C] dark:text-[#5FA6B4]';
                      if (item.severity === 'Critical') {
                        sevBadge = 'bg-[#A8432B] dark:bg-[#E07B60] text-white';
                        numCls = 'text-[#A8432B] dark:text-[#E07B60]';
                      } else if (item.severity === 'High') {
                        sevBadge = 'bg-[#E3A208] dark:bg-[#F0B83A] text-[#17232A]';
                        numCls = 'text-[#E3A208] dark:text-[#F0B83A]';
                      }

                      return (
                        <div key={idx} className="py-5 first:pt-0 last:pb-0 flex gap-4">
                          <span className={`text-3xl font-bold font-condensed leading-none w-8 text-right shrink-0 ${numCls}`}>
                            {idx + 1}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${sevBadge}`}>
                                {item.severity}
                              </span>
                              <span className="text-xs text-[#56656D] dark:text-[#94A4AB] font-medium">
                                · {item.from_ravi ? "From Chief Ravi's Handover & Records" : 'From PMS Records Only'}
                              </span>
                            </div>
                            <h3 className="text-lg font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB]">
                              {item.title}
                            </h3>
                            <p className="text-sm text-[#17232A] dark:text-[#E2E9EB] mt-1 leading-relaxed">
                              {item.what_to_know}
                            </p>

                            {/* Imperative Action Items */}
                            {item.actions && item.actions.length > 0 && (
                              <div className="mt-3">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-[#56656D] dark:text-[#94A4AB] block mb-1">
                                  Action Required for Jose:
                                </span>
                                <ul className="space-y-1">
                                  {item.actions.map((act, aIdx) => (
                                    <li
                                      key={aIdx}
                                      className="text-xs flex items-start gap-2 text-[#17232A] dark:text-[#E2E9EB]"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-[#14424C] dark:bg-[#5FA6B4] mt-1.5 shrink-0" />
                                      <span>{act}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Sources Citation */}
                            <div className="mt-2 text-[11px] text-[#56656D] dark:text-[#94A4AB] font-mono">
                              Sources: {item.sources?.join(', ') || 'Chief interview'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Upcoming and Overdue Jobs Table */}
                  {state.briefing.upcoming && state.briefing.upcoming.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-[#C5CDD1] dark:border-[#2A3C43]">
                      <h4 className="text-base font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB] mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-[#E3A208]" />
                        Upcoming and Overdue Machinery Maintenance
                      </h4>
                      <div className="border border-[#C5CDD1] dark:border-[#2A3C43] rounded overflow-hidden">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-[#EDF1F2] dark:bg-[#1C2D34] text-[#56656D] dark:text-[#94A4AB]">
                            <tr>
                              <th className="p-2.5 font-semibold">Job / Machinery</th>
                              <th className="p-2.5 font-semibold">Due Date</th>
                              <th className="p-2.5 font-semibold">Operational Remarks</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#C5CDD1] dark:divide-[#2A3C43] bg-white dark:bg-[#0E191E]">
                            {state.briefing.upcoming.map((u, uIdx) => (
                              <tr key={uIdx} className="hover:bg-[#F6F8F8] dark:hover:bg-[#16242A]">
                                <td className="p-2.5 font-medium text-[#17232A] dark:text-[#E2E9EB]">
                                  {u.job}
                                </td>
                                <td className={`p-2.5 font-semibold whitespace-nowrap ${
                                  /overdue/i.test(u.due) ? 'text-[#A8432B] dark:text-[#E07B60]' : 'text-[#56656D] dark:text-[#94A4AB]'
                                }`}>
                                  {u.due}
                                </td>
                                <td className="p-2.5 text-[#56656D] dark:text-[#94A4AB]">
                                  {u.note}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                {/* Grounded Ship Q&A Chatbot: Ask the Ship */}
                <div className="bg-[#F6F8F8] dark:bg-[#16242A] border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-6 shadow-sm">
                  <div className="mb-4">
                    <h3 className="text-xl font-bold font-condensed text-[#17232A] dark:text-[#E2E9EB] flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-[#E3A208]" />
                      Ask the Ship's Memory (Grounded Machinery Chat)
                    </h3>
                    <p className="text-xs text-[#56656D] dark:text-[#94A4AB] mt-0.5">
                      Query machinery quirks, operational workarounds, and maintenance logs. All answers are strictly grounded in Ravi's handover statements and ship logs.
                    </p>
                  </div>

                  {/* Suggested Question Chips */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {DEFAULT_QUESTIONS.map(q => (
                      <button
                        key={q}
                        onClick={() => handleAskQuestion(q)}
                        disabled={isAsking}
                        className="px-2.5 py-1 text-xs rounded bg-[#EDF1F2] dark:bg-[#1C2D34] hover:bg-[#C5CDD1] dark:hover:bg-[#2A3C43] text-[#17232A] dark:text-[#E2E9EB] border border-[#C5CDD1] dark:border-[#2A3C43] transition-colors text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>

                  {/* Chat Input */}
                  <div className="flex items-center gap-2 mb-4">
                    <input
                      type="text"
                      value={askInput}
                      onChange={e => setAskInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAskQuestion()}
                      placeholder="e.g. Can I run seawater pump No. 2 all day? Or what is the FO return line status?"
                      className="flex-1 p-2.5 text-xs sm:text-sm rounded border border-[#C5CDD1] dark:border-[#2A3C43] bg-white dark:bg-[#0E191E] text-[#17232A] dark:text-[#E2E9EB] focus:ring-2 focus:ring-[#14424C] focus:outline-none"
                    />
                    <button
                      onClick={() => handleAskQuestion()}
                      disabled={!askInput.trim() || isAsking}
                      className="px-4 py-2.5 rounded text-xs sm:text-sm font-bold bg-[#14424C] hover:bg-[#1c5663] text-white disabled:opacity-50 flex items-center gap-1.5 shadow"
                    >
                      <Send className="w-4 h-4" />
                      Ask
                    </button>
                  </div>

                  {/* Chat Message Stream */}
                  {chatHistory.length > 0 && (
                    <div className="border border-[#C5CDD1] dark:border-[#2A3C43] rounded-lg p-4 bg-white dark:bg-[#0E191E] max-h-96 overflow-y-auto flex flex-col gap-3">
                      {chatHistory.map(msg => (
                        <div
                          key={msg.id}
                          className={`p-3 rounded-lg text-xs sm:text-sm max-w-xl ${
                            msg.role === 'user'
                              ? 'bg-[#14424C] text-[#F6F8F8] self-end'
                              : 'bg-[#EDF1F2] dark:bg-[#1C2D34] text-[#17232A] dark:text-[#E2E9EB] self-start border border-[#C5CDD1] dark:border-[#2A3C43]'
                          }`}
                        >
                          <div className="text-[10px] font-bold opacity-75 uppercase tracking-wider mb-1 flex items-center justify-between">
                            <span>{msg.sender}</span>
                            <span>{msg.timestamp}</span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        </div>
                      ))}
                      {isAsking && (
                        <div className="p-3 rounded-lg bg-[#EDF1F2] dark:bg-[#1C2D34] text-[#17232A] dark:text-[#E2E9EB] self-start border border-[#C5CDD1] dark:border-[#2A3C43] text-xs flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3A208]" />
                          <span>Searching ship logs and Ravi's interview transcript...</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#14424C] dark:bg-[#0c2228] text-[#9bbcc4] text-xs py-4 border-t border-[#235864] mt-auto">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>
            Ship's Memory · MV Coral Meridian Machinery Handover Intelligence · Powered by Google Gemini AI
          </span>
          <div className="flex items-center gap-3">
            <span>{saving ? 'Saving changes...' : 'Registry Synced'}</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          </div>
        </div>
      </footer>
    </div>
  );
}
