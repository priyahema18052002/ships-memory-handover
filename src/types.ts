export type Role = 'office' | 'ravi' | 'jose';

export interface Finding {
  id: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  title: string;
  summary: string;
  evidence: string[];
  question: string;
}

export interface InterviewEntry {
  fid: string;
  original?: string;
  language?: string;
  english?: string;
  followUp?: string;
  skipped?: boolean;
}

export interface FollowUpState {
  [findingId: string]: {
    q: string;
    pending: boolean;
  };
}

export interface BriefingItem {
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  title: string;
  what_to_know: string;
  actions: string[];
  sources: string[];
  from_ravi: boolean;
}

export interface UpcomingJob {
  job: string;
  due: string;
  note: string;
}

export interface Briefing {
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  sender: string;
  text: string;
  originalText?: string;
  language?: string;
  timestamp: string;
  isFollowUp?: boolean;
  chips?: string[];
}
