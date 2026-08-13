import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  Plus, X, Check, ChevronLeft, AlertTriangle, Sparkles,
  LayoutGrid, Swords, TrendingUp, Package, User, Skull, RotateCcw
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────
type Screen = "home" | "quests" | "skills" | "loot" | "profile";
type QuestCategory = "BODY" | "MIND" | "SPIRIT" | "CRAFT" | "WEALTH";
type QuestRank = "S" | "A" | "B" | "C" | "D" | "E";
type QuestStatus = "active" | "done" | "failed";
type Modal = "add-quest" | "ai-generate" | "ai-review" | "level-up" | "penalty" | "quest-detail" | "confirm-reset" | null;
type AIProvider = "openai" | "gemini";

interface Stats { str: number; int: number; wis: number; dex: number; fth: number; cha: number; }

interface AIProfile {
  age: string;
  height: string;
  academics: string;
  nextExam: string;
  occupation: string;
  interest: string;
  faith: string;
  region: string;
  weather: string;
  notes: string;
}

interface WeatherLookup {
  label: string;
  isLoading: boolean;
  error: string;
}

interface Perk { id: string; name: string; description: string; }

interface Player {
  codename: string;
  title: string;
  level: number;
  xp: number;
  totalXp: number;
  hp: number;
  maxHp: number;
  gold: number;
  streak: number;
  lastCheckIn: string;
  joinDate: string;
  stats: Stats;
  perks: Perk[];
  unallocated: number;
}

interface Objective { id: string; text: string; done: boolean; }

interface Quest {
  id: string;
  title: string;
  description: string;
  category: QuestCategory;
  rank: QuestRank;
  xpReward: number;
  goldReward: number;
  hpPenalty: number;
  deadline: number;
  status: QuestStatus;
  objectives: Objective[];
  createdAt: number;
  completedAt?: number;
  generatedBy?: "ai";
}

type QuestDraft = Omit<Quest, "id" | "status" | "createdAt">;

interface AIConnection { provider: AIProvider; apiKey: string; model: string; }
interface GeneratedTaskResponse {
  title: string;
  category: QuestCategory;
  rank: QuestRank;
  durationHours: number;
  objectives: string[];
  rationale: string;
}

// ─────────────────────────────────────────────────────────────────
// CONSTANTS & UTILS
// ─────────────────────────────────────────────────────────────────
const P_KEY = "bos_v3_player";
const Q_KEY = "bos_v3_quests";
const PEN_KEY = "bos_v3_penalized";
const AI_KEY = "bos_v3_ai_profile";
const AI_CONNECTION_KEY = "bos_v3_ai_connection";

const XP_FOR_LEVEL = (lvl: number) => Math.round(150 * Math.pow(1.4, lvl - 1));
const CLASS_FOR = (lvl: number) => {
  if (lvl >= 50) return "ASCENDANT";
  if (lvl >= 30) return "LEGEND";
  if (lvl >= 20) return "CHAMPION";
  if (lvl >= 15) return "VETERAN";
  if (lvl >= 10) return "WARRIOR";
  if (lvl >= 5) return "INITIATE";
  return "RECRUIT";
};

const RANK_XP: Record<QuestRank, number> = { S: 600, A: 350, B: 200, C: 120, D: 75, E: 40 };
const RANK_GOLD: Record<QuestRank, number> = { S: 120, A: 70, B: 35, C: 20, D: 10, E: 5 };
const RANK_HP: Record<QuestRank, number> = { S: 45, A: 30, B: 20, C: 15, D: 10, E: 5 };

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const pad2 = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");

const fmtCountdown = (ms: number) => {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  return `${pad2(s / 3600)}:${pad2((s % 3600) / 60)}:${pad2(s % 60)}`;
};

const fmtClock = (ts: number) => {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

const fmtDeadlineTime = (ts: number) => {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  return `${pad2(h % 12 || 12)}:${pad2(m)} ${ampm}`;
};

const datetimeLocalValue = (ts: number) => {
  const d = new Date(ts);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};

const todayMidnight = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

function daysUntilExam(examDate: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return null;
  const examEnd = new Date(`${examDate}T23:59:59`).getTime();
  if (Number.isNaN(examEnd)) return null;
  return Math.ceil((examEnd - now) / (24 * 60 * 60 * 1000));
}

const CODENAMES = ["APEX", "VOID", "IRON", "NOVA", "BYTE", "GRIT", "FLUX", "DARK", "EDGE", "ZERO", "VEIL", "CORE"];
const genCodename = () =>
  `${CODENAMES[Math.floor(Math.random() * CODENAMES.length)]}_${String(Math.floor(Math.random() * 999)).padStart(3, "0")}`;

const PERKS_DB: Record<string, Perk> = {
  first_blood: { id: "first_blood", name: "FIRST BLOOD",   description: "Completed first quest." },
  ten_quests:  { id: "ten_quests",  name: "QUEST RUNNER",  description: "10 quests completed." },
  s_rank:      { id: "s_rank",      name: "S-RANK SLAYER", description: "Cleared an S-rank quest." },
  streak_7:    { id: "streak_7",    name: "IRON WILL",     description: "7-day streak achieved." },
  lvl5:        { id: "lvl5",        name: "INITIATE",      description: "Reached Level 5." },
  lvl10:       { id: "lvl10",       name: "WARRIOR",       description: "Reached Level 10." },
};

const RANK_COLOR: Record<QuestRank, string> = {
  S: "text-red-400 border-red-500",
  A: "text-orange-400 border-orange-500",
  B: "text-yellow-300 border-yellow-500",
  C: "text-emerald-400 border-emerald-500",
  D: "text-sky-400 border-sky-500",
  E: "text-gray-400 border-gray-600",
};

const CAT_COLOR: Record<QuestCategory, string> = {
  BODY:   "text-red-400",
  MIND:   "text-sky-400",
  SPIRIT: "text-yellow-300",
  CRAFT:  "text-emerald-400",
  WEALTH: "text-orange-400",
};

const AI_CATEGORIES: QuestCategory[] = ["MIND", "CRAFT", "BODY", "SPIRIT", "WEALTH"];
const DEFAULT_AI_PROFILE: AIProfile = {
  age: "",
  height: "",
  academics: "",
  nextExam: "",
  occupation: "",
  interest: "",
  faith: "",
  region: "",
  weather: "",
  notes: "",
};
const STAT_LABELS: Record<keyof Stats, string> = {
  str: "STRENGTH",
  int: "INSIGHT",
  wis: "WISDOM",
  dex: "DEXTERITY",
  fth: "FAITH",
  cha: "CHARISMA",
};

const STAT_TO_CATEGORY: Record<keyof Stats, QuestCategory> = {
  str: "BODY",
  int: "MIND",
  wis: "SPIRIT",
  dex: "CRAFT",
  fth: "SPIRIT",
  cha: "WEALTH",
};

function weakestStat(stats: Stats) {
  return (Object.entries(stats) as [keyof Stats, number][]).sort((a, b) => a[1] - b[1])[0][0];
}

function strongestStat(stats: Stats) {
  return (Object.entries(stats) as [keyof Stats, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

function normalizeTitle(text: string) {
  return text
    .trim()
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function firstMeaningful(...values: string[]) {
  return values.map(value => value.trim()).find(Boolean) || "";
}

function hasIslamicFaith(faith: string) {
  return /\b(islam|muslim|muslimah|islamic)\b/i.test(faith);
}

function textTokens(text: string) {
  return [...new Set((text.toUpperCase().match(/[A-Z0-9]+/g) ?? []).filter(token => token.length > 2))];
}

function questCategoryFromText(text: string): QuestCategory {
  const tokens = textTokens(text);
  if (tokens.some(token => /ISLAM|MUSLIM|MUSLIMAH|SALAH|PRAY|QURAN|QURANIC|DUA|AZAN|ADHAN/.test(token))) return "SPIRIT";
  if (tokens.some(token => /FIT|RUN|GYM|BODY|HEALTH|MOVE|TRAIN|WALK|STRETCH/.test(token))) return "BODY";
  if (tokens.some(token => /WRITE|READ|STUDY|LEARN|PLAN|RESEARCH|BRAIN|THINK|ACADEM|SCHOOL|COLLEGE|CODE|CODING|PROGRAM|CYBER|SECUR|HACK|VULN|BIO|PANTHERA|LEO|LION/.test(token))) return "MIND";
  if (tokens.some(token => /MONEY|BUDGET|SAVE|SPEND|INVEST|DEBT|BILL|WEALTH|INCOME|CASH|WORK|JOB|CAREER/.test(token))) return "WEALTH";
  if (tokens.some(token => /MEDIT|PRAY|JOURNAL|BREATH|CALM|MINDFUL|RESET|REFLECT|FAITH|SPIRIT|DUA|SALAH|QURAN/.test(token))) return "SPIRIT";
  if (tokens.some(token => /BUILD|CODE|DESIGN|CREATE|SHIP|MAKE|CRAFT|ART|PROJECT|SKILL/.test(token))) return "CRAFT";
  return AI_CATEGORIES[Math.abs(text.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % AI_CATEGORIES.length];
}

function academicTopic(profile: AIProfile, variant = 0) {
  const academic = profile.academics.trim();
  const signals = [academic, profile.interest, profile.occupation, profile.notes].join(" ").toUpperCase();
  const choose = (topics: string[]) => topics[variant % topics.length];
  const isBroadDegree = /\b(B\s*\.?\s*E|B\s*TECH|BACHELOR|CSE|COMPUTER\s*SCIENCE|COMPUTER\s*ENGINEERING)\b/.test(academic.toUpperCase());

  // Prefer an explicit interest or skill signal over the degree title itself.
  if (/LINKED\s*LIST|NODE|LIST/.test(signals)) return "Linked List Operations";
  if (/VIRUS|VIROLOGY|CAPSID/.test(signals)) return choose(["Virus Capsid Structure", "Viral Replication Cycle"]);
  if (/MICROBIO|BACTERIA|BACTERIAL/.test(signals)) return choose(["Bacterial Cell Structure", "Bacterial Growth Phases"]);
  if (/GENETIC|GENE|DNA|RNA|MOLECULAR/.test(signals)) return choose(["DNA Replication", "Gene Expression Basics"]);
  if (/BIO|BIOLOGY|LIFE\s*SCIENCE|BIOTECH|ZOOLOGY|BOTANY/.test(signals)) {
    return choose(["Virus Capsid Structure", "DNA Replication", "Cell Membrane Transport"]);
  }
  if (/(?:\bC\b|C\s*PROGRAMMING|LOW[\s-]*LEVEL|POINTER|MEMORY)/.test(signals)) {
    return choose(["C Pointers and Memory", "C Memory Layout"]);
  }
  if (/CYBER|SECUR|PENTEST|HACK|VULN|CVE/.test(signals)) return choose(["Network Security Basics", "Threat Modeling Basics"]);
  if (/ALGORITHM|DSA|DATA\s*STRUCT/.test(signals)) return choose(["Linked List Operations", "Sorting Algorithm Basics"]);
  if (/DATABASE|DBMS|SQL/.test(signals)) return choose(["SQL Query Practice", "Database Normalization"]);
  if (/OPERATING\s*SYSTEM|\bOS\b/.test(signals)) return choose(["Process Scheduling", "Virtual Memory Basics"]);
  if (/NETWORK|TCP|HTTP/.test(signals)) return choose(["TCP/IP Fundamentals", "HTTP Request Flow"]);
  if (isBroadDegree) return choose(["Linked List Operations", "SQL Query Practice", "Process Scheduling"]);
  return firstMeaningful(academic, "Study Sprint");
}

function faithTopic(profile: AIProfile, variant = 0) {
  const notes = profile.notes.trim();
  // A named Surah is user-led: accept “Surah Al-Munafiqun 1-4” or
  // “Surah Al Munafiqun, ayahs 1 to 4” from notes, but never invent one.
  const mentionedSurah = notes.match(/(?:surah\s+)?((?:al[-\s])?[a-z]+(?:\s+[a-z]+)?)(?:\s*[,:(-]?\s*(?:ayahs?\s*)?(\d+)\s*(?:to|-|–)\s*(\d+))?/i);
  if (mentionedSurah && /surah/i.test(notes)) {
    const surah = normalizeTitle(mentionedSurah[1]).replace(/^Al /, "Al-");
    const ayahs = mentionedSurah[2] && mentionedSurah[3] ? `, ayahs ${mentionedSurah[2]}–${mentionedSurah[3]}` : "";
    return `Read Surah ${surah}${ayahs}`;
  }
  if (hasIslamicFaith(profile.faith)) return ["Prayer Check-In", "Morning Dhikr"][variant % 2];
  return firstMeaningful(notes, "Faith Check");
}

function canonicalQuestFocus(profile: AIProfile, player: Player, category: QuestCategory, topicVariant = 0) {
  const academic = profile.academics.trim();
  const interest = profile.interest.trim();
  const occupation = profile.occupation.trim();
  const notes = profile.notes.trim();
  const haystack = [academic, occupation, interest, notes].join(" ").toUpperCase();

  // Keep each lane tied to the field that earned its priority.  Previously a
  // faith value could make every generated quest a Salah quest, including study.
  if (category === "MIND") {
    if (academic) return academicTopic(profile, topicVariant);
    if (/LINKED\s*LIST|NODE|LIST|ALGORITHM|DSA|DATA\s*STRUCT|PROGRAMMING|CODING|CODE/.test(haystack)) return "Linked List Drill";
    if (/ZERO[-\s]*DAY|0DAY|CVE|VULN|SECUR|PENTEST|HACK|DEFENSE/.test(haystack)) return "Zero-Day Basics";
    if (/BIO|BIOLOGY|ANIMAL|ZOO|PANTHERA|LEO|LION|NATURE/.test(haystack)) return "Panthera Leo";
    return "Study Sprint";
  }
  if (category === "SPIRIT") return faithTopic(profile, topicVariant);
  if (category === "BODY") return firstMeaningful(interest, notes, "Movement Reset");
  if (category === "WEALTH") return firstMeaningful(occupation, notes, "Money Move");
  if (category === "CRAFT") return firstMeaningful(interest, occupation, academic, "Tiny Build");
  return firstMeaningful(academic, interest, occupation, player.title, "Quest Drop");
}

function styleIndex(seed: string, styles: number) {
  return Math.abs(seed.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % styles;
}

function questTitle(seed: string, focus: string, category: QuestCategory, faith: string) {
  const resolvedFocus = normalizeTitle(focus);

  // Study titles are built from the selected topic rather than from a fixed
  // catalogue of subjects. This keeps “DNA Replication” and future subjects
  // accurate while still giving regenerated batches a little variation.
  if (category === "MIND") {
    const activity = ["Study Sprint", "Revision Block", "Focus Session", "Practice Lab", "Deep Work"][styleIndex(`${seed}:${resolvedFocus}:study`, 5)];
    return `${resolvedFocus} // ${activity}`;
  }

  if (category === "SPIRIT" && (hasIslamicFaith(faith) || /SALAH|ADHAAN|AZAAN|WUDHU|WADHU|QURAN|QUR'AN|DUA|DHIKR/i.test(resolvedFocus))) {
    const islamicNames = [
      `Mujahid Squad: ${resolvedFocus}`,
      `Salah Ops // ${resolvedFocus}`,
      `Adhaan Alert // ${resolvedFocus}`,
      `Wudhu Run // ${resolvedFocus}`,
      `Noor Mode // ${resolvedFocus}`,
    ];
    return islamicNames[styleIndex(`${seed}:${resolvedFocus}:islam`, islamicNames.length)];
  }

  if (/KASHMIR|SRINAGAR|ANANTNAG|BARAMULLA|PULWAMA|PAMPORE|DAL|WULLAR/i.test(`${seed} ${focus} ${faith}`)) {
    const kashmiriNames = [
      `Akh Baar // ${resolvedFocus}`,
      `Chalo Yaar // ${resolvedFocus}`,
      `Vadi Mode // ${resolvedFocus}`,
      `Yim Kaam // ${resolvedFocus}`,
      `Kashmir Grind // ${resolvedFocus}`,
    ];
    return kashmiriNames[styleIndex(`${seed}:${resolvedFocus}:kashmir`, kashmiriNames.length)];
  }

  const titlePools: Record<QuestCategory | "DEFAULT", { english: string[]; urdu: string[]; arabic: string[] }> = {
    BODY: {
      english: ["Hydration Arc", "Water Reset", "Daily Boost", "Boss Warmup", "Level Up Move"],
      urdu: ["Paani Scene", "Seedha Kaam", "Yaar Grind", "Full Jugaad", "Chalo Start"],
      arabic: ["Baraka Mode", "Sabr Sprint", "Noor Check", "Yalla Move", "Mujahid Run"],
    },
    MIND: {
      // MIND titles are returned above from the dynamically selected focus.
      english: ["Study Sprint", "Deep Work", "Revision Block", "Focus Session", "Study Mode"],
      urdu: ["Dimagh Ka Scene", "Kya Scene Hai", "Bhai Ka Study", "Seedha Notes", "Jugaad Learn"],
      arabic: ["Noor Raid", "Sabr Notes", "Mujahid Study", "Yalla Learn", "Adhaan Think"],
    },
    SPIRIT: {
      english: ["Spiritual Speedrun", "Dua Drop", "Faith Mode", "Salah Circuit", "Noor Check"],
      urdu: ["Dua Scene", "Bhai Sabr", "Seedha Sajda", "Noor Wala Vibe", "Allah Ka Kaam"],
      arabic: ["Salah Ops", "Adhaan Alert", "Wudhu Run", "Noor Mode", "Mujahid Squad"],
    },
    WEALTH: {
      english: ["Bag Secure", "Money Mission", "Cash Flow", "Budget Boss", "Paisa Play"],
      urdu: ["Paisa Scene", "Bhai Funds", "Jugaad Budget", "Seedha Save", "Kaam Ka Cash"],
      arabic: ["Baraka Bag", "Sabr Budget", "Mujahid Money", "Noor Vault", "Yalla Earn"],
    },
    CRAFT: {
      english: ["Main Character Build", "Skill Drop", "Boss Fight Build", "Tiny Build", "Ship It"],
      urdu: ["Scene Build", "Bhai Maker", "Jugaad Forge", "Seedha Ship", "Kaam Finish"],
      arabic: ["Yalla Build", "Noor Forge", "Baraka Craft", "Mujahid Build", "Sabr Ship"],
    },
    DEFAULT: {
      english: ["Quest Drop", "Side Quest", "Main Character Moment", "Mission Lane", "Daily Run"],
      urdu: ["Scene Drop", "Bhai Quest", "Seedha Mission", "Jugaad Lane", "Kaam Mode"],
      arabic: ["Yalla Quest", "Noor Path", "Sabr Mode", "Baraka Lane", "Mujahid Path"],
    },
  };

  const pools = titlePools[category] ?? titlePools.DEFAULT;
  const roll = styleIndex(`${seed}:${resolvedFocus}:${category}:${faith}`, 10);
  const prefix = roll < 5
    ? pools.english[styleIndex(`${seed}:${resolvedFocus}:english`, pools.english.length)]
    : roll < 8
      ? pools.urdu[styleIndex(`${seed}:${resolvedFocus}:urdu`, pools.urdu.length)]
      : pools.arabic[styleIndex(`${seed}:${resolvedFocus}:arabic`, pools.arabic.length)];
  return `${prefix} // ${resolvedFocus}`;
}

function buildSimpleObjectives(profile: AIProfile, player: Player, category: QuestCategory, focus: string, activeCount: number, doneToday: number) {
  const normalizedFocus = normalizeTitle(firstMeaningful(focus, "MISSION"));
  const lowercaseFocus = normalizedFocus.toLowerCase();

  switch (category) {
    case "BODY":
      return [
        "Drink one glass of water",
        "Move for 5 minutes",
        `Stretch once and keep the ${player.streak} day streak alive`,
      ];
    case "MIND":
      if (/VIRUS CAPSID/i.test(normalizedFocus)) {
        return [
          "Learn the capsid's role in protecting viral genetic material",
          "Sketch one capsid symmetry type",
          "Write 3 notes on capsid versus viral envelope",
        ];
      }
      if (/VIRAL REPLICATION/i.test(normalizedFocus)) {
        return [
          "List the main stages of viral replication",
          "Explain one stage in your own words",
          "Write 3 notes on host-cell involvement",
        ];
      }
      if (/LINKED LIST/i.test(normalizedFocus)) {
        return [
          "Read how a linked list node works",
          "Draw one linked list by hand",
          "Explain insert vs delete in 3 lines",
        ];
      }
      if (/C POINTERS/i.test(normalizedFocus)) {
        return [
          "Trace a pointer variable to one memory address",
          "Write a tiny C program that uses a pointer",
          "Explain * and & in 3 lines",
        ];
      }
      if (/C MEMORY LAYOUT/i.test(normalizedFocus)) {
        return [
          "Sketch stack, heap, and data segments",
          "Identify where one local C variable lives",
          "Write 3 notes on stack versus heap memory",
        ];
      }
      if (/NETWORK SECURITY/i.test(normalizedFocus)) {
        return [
          "Learn the difference between authentication and authorization",
          "Identify one common network attack",
          "Write 3 notes on its basic mitigation",
        ];
      }
      if (/ZERO-DAY|ZERO DAY/i.test(normalizedFocus)) {
        return [
          "Learn what a zero-day means",
          "Read one short CVE writeup",
          "Write 3 notes on why patching matters",
        ];
      }
      if (/PANTHERA LEO/i.test(normalizedFocus)) {
        return [
          "Read one fact about Panthera leo",
          "Learn where lions live",
          "Write one sentence on why the species matters",
        ];
      }
      return [
        `Learn one small thing about ${lowercaseFocus}`,
        `Write 3 bullet notes about ${lowercaseFocus}`,
        `Finish one tiny practice round for ${normalizedFocus}`,
      ];
    case "SPIRIT":
      if (/READ SURAH/i.test(normalizedFocus)) {
        return [
          `Read or listen to ${normalizedFocus.replace(/^Read /i, "")}`,
          "Read one short translation or tafsir note",
          "Write one takeaway to carry into the day",
        ];
      }
      if (hasIslamicFaith(profile.faith)) {
        return [
          "Pray on time",
          "Protect the next salah window",
          "Do 3 minutes of dhikr",
        ];
      }
      return [
        "Pause for 2 minutes and breathe",
        `Make one sincere intention for ${player.codename}`,
        `Close the day with one gratitude note after ${doneToday + 1} wins`,
      ];
    case "WEALTH":
      return [
        "Check one money move",
        "Log one spend or save action",
        `Protect the bag and clear ${Math.max(activeCount, 1)} active quest slots`,
      ];
    case "CRAFT":
    default: {
      const craftSeed = firstMeaningful(profile.interest, profile.occupation, profile.academics, normalizedFocus);
      const craftFocus = normalizeTitle(craftSeed);
      if (/LINKED LIST/i.test(craftFocus)) {
        return [
          "Read how a linked list node works",
          "Draw one linked list by hand",
          "Explain insert vs delete in 3 lines",
        ];
      }
      return [
        `Build one tiny piece of ${craftFocus}`,
        `Practice a single step of ${lowercaseFocus}`,
        `Ship one small improvement for ${player.title}`,
      ];
    }
  }
}

function profileSummary(profile: AIProfile) {
  return [
    profile.age && `Age ${profile.age}`,
    profile.height && `Height ${profile.height}`,
    profile.academics && `Academics ${profile.academics}`,
    profile.nextExam && `Next exam ${profile.nextExam}`,
    profile.occupation && `Occupation ${profile.occupation}`,
    profile.interest && `Interest ${profile.interest}`,
    profile.faith && `Faith ${profile.faith}`,
    profile.region && `Region ${profile.region}`,
    profile.weather && `Weather ${profile.weather}`,
    profile.notes && `Notes ${profile.notes}`,
  ].filter(Boolean).join(" · ");
}

function themeCategory(theme: string): QuestCategory {
  const normalized = theme.toUpperCase();
  if (/FIT|RUN|GYM|BODY|HEALTH|MOVE|TRAIN|WALK|REST|SLEEP|STRETCH/.test(normalized)) return "BODY";
  if (/WRITE|READ|STUDY|LEARN|PLAN|RESEARCH|BRAIN|THINK|ACADEM|SCHOOL|COLLEGE/.test(normalized)) return "MIND";
  if (/MONEY|BUDGET|SAVE|SPEND|INVEST|DEBT|BILL|WEALTH|INCOME|CASH|WORK|JOB|CAREER/.test(normalized)) return "WEALTH";
  if (/MEDIT|PRAY|JOURNAL|BREATH|CALM|MINDFUL|RESET|REFLECT|FAITH|SPIRIT/.test(normalized)) return "SPIRIT";
  if (/BUILD|CODE|DESIGN|CREATE|SHIP|MAKE|CRAFT|ART|PROJECT|SKILL/.test(normalized)) return "CRAFT";
  return AI_CATEGORIES[Math.abs(normalized.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % AI_CATEGORIES.length];
}

function taskGenerationPrompt(profile: AIProfile, player: Player, now: number) {
  const examDays = daysUntilExam(profile.nextExam, now);
  return `You generate a balanced, personalized task batch for one person. Return ONLY valid JSON in this exact shape: {"tasks":[{"title": string, "category": "BODY"|"MIND"|"SPIRIT"|"CRAFT"|"WEALTH", "rank": "A"|"B"|"C"|"D"|"E", "durationHours": number, "objectives": [string,string,string], "rationale": string}]}. Include exactly 5 tasks.

Use only the person context below. Do not invent a named course topic, Surah, ayah, exam, or obligation that is not stated. Academic tasks must name a specific topic inferred from current subjects/interests/notes—not merely the degree. Titles must lead with that actual topic. Keep objectives concrete, short, and achievable.

Always include a gentle body/wellness task when fitness or health appears; simple tasks such as hydration and movement must remain simple. Include a faith task only when faith is supplied. If a named Surah or ayah range is in notes, use exactly that; otherwise use a general faith practice without inventing a Surah. Balance the rest by the user's stated priorities. If the next exam is 0–30 days away, increase academic focus modestly (one extra academic task at most), without dropping faith or simple wellness tasks. Set durationHours by complexity: tiny habits 1–4, ordinary study 4–12, deeper work 12–36. Do not include a task that is just a degree name.

PERSON CONTEXT:
${JSON.stringify({ profile, player: { codename: player.codename, title: player.title, level: player.level, streak: player.streak }, examDays }, null, 2)}`;
}

async function requestAiTaskBatch(connection: AIConnection, profile: AIProfile, player: Player, now: number): Promise<GeneratedTaskResponse[]> {
  const prompt = taskGenerationPrompt(profile, player, now);
  let content = "";
  if (connection.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify({ model: connection.model, input: prompt, text: { format: { type: "json_object" } }, store: false }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed (${response.status}). Check the key and model.`);
    const payload = await response.json() as { output_text?: string };
    content = payload.output_text || "";
  } else {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(connection.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": connection.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
    });
    if (!response.ok) throw new Error(`Gemini request failed (${response.status}). Check the key and model.`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    content = payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
  }
  const parsed = JSON.parse(content) as GeneratedTaskResponse[] | { tasks?: GeneratedTaskResponse[] };
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
  if (!tasks || tasks.length !== 5) throw new Error("The AI returned an invalid task batch. Please generate again.");
  return tasks;
}

function aiTasksToDrafts(tasks: GeneratedTaskResponse[], now: number, profile: AIProfile, player: Player): QuestDraft[] {
  return tasks.map((task, index) => {
    const rank: QuestRank = ["S", "A", "B", "C", "D", "E"].includes(task.rank) ? task.rank : "C";
    const category: QuestCategory = ["BODY", "MIND", "SPIRIT", "CRAFT", "WEALTH"].includes(task.category) ? task.category : "MIND";
    const durationHours = Math.max(1, Math.min(168, Number(task.durationHours) || 6));
    return {
      title: task.title.trim() || `Task ${index + 1}`,
      description: `AI priority ${index + 1}/5 · ${task.rationale || "Personalized from your profile"} · ${profileSummary(profile)} · ${player.codename}`,
      category,
      rank,
      xpReward: RANK_XP[rank], goldReward: RANK_GOLD[rank], hpPenalty: RANK_HP[rank],
      deadline: now + durationHours * 60 * 60 * 1000,
      objectives: task.objectives.slice(0, 3).filter(Boolean).map(text => ({ id: uid(), text, done: false })),
      generatedBy: "ai",
    };
  });
}

function weatherDescription(code: number) {
  if (code === 0) return "Clear";
  if ([1, 2].includes(code)) return "Mostly clear";
  if (code === 3) return "Cloudy";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57].includes(code)) return "Freezing drizzle";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing rain";
  if ([71, 73, 75].includes(code)) return "Snow";
  if (code === 77) return "Snow grains";
  if ([80, 81, 82].includes(code)) return "Showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if ([96, 99].includes(code)) return "Thunderstorm with hail";
  return "Weather unknown";
}

async function fetchWeatherForRegion(region: string) {
  const query = region.trim();
  if (!query) {
    throw new Error("Enter a region to auto-fetch weather.");
  }

  const geoQueries = [query, `${query}, India`];
  let place: { latitude: number; longitude: number; name: string; country?: string; admin1?: string; } | undefined;

  for (const name of geoQueries) {
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", name);
    geoUrl.searchParams.set("count", "1");
    geoUrl.searchParams.set("language", "en");
    geoUrl.searchParams.set("format", "json");

    const geoResponse = await fetch(geoUrl.toString());
    if (!geoResponse.ok) continue;
    const geoData = await geoResponse.json() as { results?: Array<{ latitude: number; longitude: number; name: string; country?: string; admin1?: string; }> };
    place = geoData.results?.[0];
    if (place) break;
  }

  const fetchWeatherAtPlace = async (location: { latitude: number; longitude: number; name: string; country?: string; admin1?: string; }) => {
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(location.latitude));
    weatherUrl.searchParams.set("longitude", String(location.longitude));
    weatherUrl.searchParams.set("current", "temperature_2m,weather_code");
    weatherUrl.searchParams.set("temperature_unit", "fahrenheit");
    weatherUrl.searchParams.set("timezone", "auto");

    const weatherResponse = await fetch(weatherUrl.toString());
    if (!weatherResponse.ok) throw new Error("Weather lookup failed.");
    const weatherData = await weatherResponse.json() as { current?: { temperature_2m?: number; weather_code?: number } };
    const temp = weatherData.current?.temperature_2m;
    const code = weatherData.current?.weather_code;
    const placeLabel = [location.name, location.admin1, location.country].filter(Boolean).join(", ");
    return `${placeLabel} · ${typeof temp === "number" ? `${Math.round(temp)}°F` : "Temp n/a"} · ${typeof code === "number" ? weatherDescription(code) : "Weather n/a"}`;
  };

  if (place) {
    try {
      return await fetchWeatherAtPlace(place);
    } catch {
      // Fall through to the IP-based location fallback.
    }
  }

  const ipResponse = await fetch("https://ipwho.is/?fields=success,latitude,longitude,city,region,country");
  if (!ipResponse.ok) throw new Error("Weather lookup failed.");
  const ipData = await ipResponse.json() as { success?: boolean; latitude?: number; longitude?: number; city?: string; region?: string; country?: string; };
  if (!ipData.success || typeof ipData.latitude !== "number" || typeof ipData.longitude !== "number") {
    throw new Error("Weather lookup failed.");
  }

  const fallbackLocation = {
    latitude: ipData.latitude,
    longitude: ipData.longitude,
    name: ipData.city || query,
    admin1: ipData.region,
    country: ipData.country,
  };
  return await fetchWeatherAtPlace(fallbackLocation);
}

function objectiveSet(category: QuestCategory, focus: string, player: Player, activeCount: number, doneToday: number) {
  switch (category) {
    case "BODY":
      return [
        `Warm up for 5 minutes`,
        `Complete a 20 minute ${focus.toLowerCase()} session`,
        `Log how ${player.hp}/${player.maxHp} HP feels after training`,
      ];
    case "MIND":
      return [
        `Study ${focus.toLowerCase()} for 25 minutes`,
        `Write 3 takeaways about the current plan`,
        `Define the next action for the ${activeCount} active quests`,
      ];
    case "SPIRIT":
      return [
        `Breathe or meditate for 10 minutes`,
        `Journal one clear intention about ${player.codename}`, 
        `State a commitment for the next ${doneToday + 1} wins`,
      ];
    case "WEALTH":
      return [
        `Review one spending or saving decision`,
        `Track one money action from today`,
        `Execute one wealth move before the deadline`,
      ];
    case "CRAFT":
    default:
      return [
        `Draft the first version of ${focus.toLowerCase()}`,
        `Refine one rough edge`,
        `Ship or save the result`,
      ];
  }
}

function generateAiQuestsFromState(player: Player, quests: Quest[], now: number, profile: AIProfile): Omit<Quest, "id" | "status" | "createdAt">[] {
  const active = quests.filter(q => q.status === "active");
  const doneToday = quests.filter(q => q.status === "done" && q.completedAt && todayStr() === new Date(q.completedAt).toISOString().slice(0, 10)).length;
  const summary = profileSummary(profile);
  const contextLine = `${player.codename} · ${player.title} · LVL ${player.level} · ${player.hp}/${player.maxHp} HP · ${player.gold} GOLD · ${player.streak}D STREAK · ${active.length} ACTIVE · ${doneToday} DONE TODAY`;
  const batchSeed = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const examDays = daysUntilExam(profile.nextExam, now);
  const examPrepMode = examDays !== null && examDays >= 0 && examDays <= 30;
  const interestCategory = questCategoryFromText(profile.interest);
  const occupationCategory = questCategoryFromText(profile.occupation);
  const priority: QuestCategory[] = [];
  const addPriority = (category: QuestCategory) => priority.push(category);

  // Academics get two slots when supplied. The remaining profile fields then
  // fill the batch in a predictable, user-centred order (faith before gym).
  if (profile.academics.trim()) addPriority("MIND");
  if (profile.academics.trim()) addPriority("MIND");
  if (profile.faith.trim()) addPriority("SPIRIT");
  if (profile.interest.trim()) addPriority(interestCategory);
  // The final month adds one focused study slot, without replacing faith or
  // simple body-care quests already selected from the user's profile.
  if (examPrepMode) addPriority("MIND");
  if (profile.occupation.trim()) addPriority(occupationCategory);
  for (const fallback of ["MIND", "SPIRIT", "BODY", "CRAFT", "WEALTH"] as QuestCategory[]) {
    if (priority.length >= 5) break;
    addPriority(fallback);
  }

  const ranks: QuestRank[] = ["A", "B", "C", "C", "D"];
  // Suggested windows reflect task complexity; the review screen lets the
  // user choose the final deadline for every individual quest.
  const hoursUntilDeadline = [24, 12, 8, 5, 3];
  return priority.slice(0, 5).map((category, index) => {
    const focus = canonicalQuestFocus(profile, player, category, index);
    const rank = ranks[index];
    return {
      title: questTitle(`${batchSeed}:${index}`, focus, category, profile.faith),
      description: `Priority ${index + 1}/5${examPrepMode ? ` · exam prep: ${examDays} days remaining` : ""} · generated from ${summary || "your current player state"} · ${contextLine}`,
      category,
      rank,
      xpReward: RANK_XP[rank],
      goldReward: RANK_GOLD[rank],
      hpPenalty: RANK_HP[rank],
      deadline: now + hoursUntilDeadline[index] * 60 * 60 * 1000,
      objectives: buildSimpleObjectives(profile, player, category, focus, active.length, doneToday).map(text => ({ id: uid(), text, done: false })),
      generatedBy: "ai" as const,
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// SHARED: PROGRESS BAR
// ─────────────────────────────────────────────────────────────────
function Bar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className="h-2 bg-muted w-full">
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SHARED: QUEST ROW
// ─────────────────────────────────────────────────────────────────
function QuestRow({ quest, now, onTap }: { quest: Quest; now: number; onTap: () => void }) {
  const ms = quest.deadline - now;
  const urgent = ms < 3_600_000 && ms > 0;
  const expired = ms <= 0 && quest.status === "active";

  return (
    <button
      onClick={onTap}
      className={`w-full text-left border-2 p-3 flex items-center gap-3 transition-all active:translate-x-0.5 active:translate-y-0.5 ${
        quest.status === "done"   ? "border-primary/30 bg-primary/5 opacity-60" :
        quest.status === "failed" ? "border-destructive/30 bg-destructive/5 opacity-50" :
        expired  ? "border-destructive bg-destructive/10 shadow-[2px_2px_0_#FF3131]" :
        urgent   ? "border-accent   bg-accent/5  shadow-[2px_2px_0_#FFEE00]" :
        "border-border bg-card hover:border-primary/50"
      }`}
    >
      {/* Status dot */}
      <div className={`w-2 h-2 shrink-0 ${
        quest.status === "done"   ? "bg-primary" :
        quest.status === "failed" ? "bg-destructive" :
        expired ? "bg-destructive animate-pulse" :
        urgent  ? "bg-accent animate-pulse" :
        "bg-muted-foreground"
      }`} />

      <div className="flex-1 min-w-0">
        <div className={`text-xs font-bold truncate ${
          quest.status !== "active" ? "line-through text-muted-foreground" : "text-foreground"
        }`}>
          {quest.title}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
          <span className={CAT_COLOR[quest.category]}>{quest.category}</span>
          <span className={`border px-1 ${RANK_COLOR[quest.rank]} text-[9px]`}>{quest.rank}</span>
          <span>+{quest.xpReward}XP</span>
        </div>
      </div>

      <div className={`text-[10px] tabular-nums shrink-0 font-bold ${
        quest.status === "done"   ? "text-primary" :
        quest.status === "failed" ? "text-destructive" :
        expired ? "text-destructive" :
        urgent  ? "text-accent animate-pulse" :
        "text-muted-foreground"
      }`}>
        {quest.status === "done"   ? "CLEAR" :
         quest.status === "failed" ? "FAIL" :
         expired ? "EXPIRED" :
         fmtCountdown(ms)}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────────────────────────
function OnboardingScreen({ onInit }: { onInit: (name: string) => void }) {
  const [phase, setPhase] = useState<"boot" | "name">("boot");
  const [lines, setLines] = useState<string[]>([]);
  const [name, setName] = useState("");
  const placeholder = useRef(genCodename());

  const BOOT = [
    "BEAST_OS V1.12 — COLD BOOT",
    "► Initializing discipline engine...",
    "► Loading penalty matrix...",
    "► Calibrating accountability core...",
    "► Mounting quest database...",
    "► All systems nominal. [SYS_OK]",
    "",
    "NEW ENTITY DETECTED.",
    "AWAITING IDENTIFICATION...",
  ];

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i < BOOT.length) {
        const nextLine = BOOT[i];
        setLines(p => [...p, typeof nextLine === "string" ? nextLine : ""]);
        i++;
      }
      else { clearInterval(id); setTimeout(() => setPhase("name"), 400); }
    }, 140);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
      <div className="w-full max-w-[400px] space-y-4">
        {/* Logo */}
        <div className="border-2 border-primary p-4 text-center shadow-[6px_6px_0_#00FF41]">
          <div className="text-primary font-black text-2xl tracking-[0.4em]">BEAST_OS</div>
          <div className="text-muted-foreground text-[10px] tracking-[0.3em] mt-1">DISCIPLINE ENGINE V1.12</div>
        </div>

        {/* Boot log */}
        <div className="border-2 border-border bg-card p-4 min-h-[180px] text-[11px] leading-6 space-y-0">
          {lines.map((line, i) => (
            <div key={i} className={
              (typeof line === "string" && line.startsWith("►"))         ? "text-primary" :
              (typeof line === "string" && line.includes("BEAST_OS"))    ? "text-accent font-bold" :
              (typeof line === "string" && line.includes("DETECTED"))    ? "text-accent" :
              (typeof line === "string" && line.includes("AWAITING"))    ? "text-accent" :
              line === ""                                                ? "h-3" :
              "text-muted-foreground"
            }>
              {typeof line === "string" && line ? line : " "}
            </div>
          ))}
          {phase === "boot" && <span className="text-primary animate-pulse">█</span>}
        </div>

        {/* Name entry */}
        {phase === "name" && (
          <div className="space-y-3">
            <div className="text-[10px] text-muted-foreground tracking-[0.3em]">
              ENTER OPERATIVE CODENAME:
            </div>
            <input
              autoFocus
              type="text"
              value={name}
              maxLength={20}
              onChange={e => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              onKeyDown={e => e.key === "Enter" && onInit(name.trim() || placeholder.current)}
              placeholder={placeholder.current}
              className="w-full bg-card border-2 border-primary text-primary text-base font-bold p-3 tracking-[0.2em] outline-none focus:shadow-[4px_4px_0_#00FF41] placeholder:text-muted-foreground placeholder:opacity-40"
            />
            <div className="text-[10px] text-muted-foreground">Leave blank for a random codename.</div>
            <button
              onClick={() => onInit(name.trim() || placeholder.current)}
              className="w-full bg-primary text-primary-foreground font-black text-sm py-4 tracking-[0.3em] border-2 border-primary shadow-[4px_4px_0_rgba(0,255,65,0.25)] hover:shadow-[6px_6px_0_rgba(0,255,65,0.35)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 transition-all"
            >
              [ INITIALIZE BEAST_OS ]
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SYSTEM BAR
// ─────────────────────────────────────────────────────────────────
function SystemBar({ now, deadline }: { now: number; deadline: number }) {
  const ms = deadline - now;
  const urgent   = ms < 3_600_000;
  const critical = ms < 900_000;

  return (
    <div className="border-b-2 border-border bg-card px-3 py-2 flex items-center justify-between text-[10px] tracking-wider shrink-0">
      <div className="text-muted-foreground">
        BEAST_OS <span className="text-primary font-bold">V1.12</span>
      </div>
      <div className={`flex items-center gap-1.5 tabular-nums font-bold ${
        critical ? "text-destructive animate-pulse" :
        urgent   ? "text-accent" :
        "text-muted-foreground"
      }`}>
        {critical && <AlertTriangle size={10} />}
        <span>DEADLINE {fmtCountdown(ms)}</span>
      </div>
      <div className="text-muted-foreground tabular-nums">
        {fmtClock(now)} <span className="text-primary ml-1">[OK]</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// HOME SCREEN
// ─────────────────────────────────────────────────────────────────
function HomeScreen({
  player, quests, now, deadline,
  onQuestTap,
  onAiGenerate,
}: {
  player: Player; quests: Quest[]; now: number; deadline: number;
  onQuestTap: (id: string) => void;
  onAiGenerate: () => void;
}) {
  const activeQuests = quests.filter(q => q.status === "active");
  const doneToday = quests.filter(q =>
    q.status === "done" && q.completedAt && todayStr() === new Date(q.completedAt).toISOString().slice(0, 10)
  ).length;

  const hpPct = player.hp / player.maxHp;
  const hpColor = hpPct > 0.6 ? "bg-primary" : hpPct > 0.3 ? "bg-accent" : "bg-destructive";
  const xpPct = player.xp / XP_FOR_LEVEL(player.level);
  const ms = deadline - now;
  const urgent = ms < 3_600_000;

  return (
    <div className="p-4 space-y-3 pb-24">
      {/* Player Card */}
      <div className="border-2 border-primary bg-card p-4 shadow-[4px_4px_0_#00FF41]">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-primary font-black text-xl tracking-[0.15em]">{player.codename}</div>
            <div className="text-muted-foreground text-[10px] tracking-widest mt-0.5">
              {player.title} · LVL {player.level}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={onAiGenerate}
              className="inline-flex items-center gap-1 border border-primary px-2 py-1 text-[9px] font-black tracking-[0.22em] text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              <Sparkles size={11} />
              Ai Generate
            </button>
            <div className="text-right text-[10px] space-y-0.5">
              <div className={player.streak > 0 ? "text-accent font-bold" : "text-muted-foreground"}>
                {player.streak > 0 ? `${player.streak}D STREAK` : "NO STREAK"}
              </div>
              <div className="text-orange-400">{player.gold} GOLD</div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>XP</span><span>{player.xp} / {XP_FOR_LEVEL(player.level)}</span>
            </div>
            <Bar value={player.xp} max={XP_FOR_LEVEL(player.level)} />
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>HP</span>
              <span className={hpPct < 0.3 ? "text-destructive font-bold" : ""}>{player.hp} / {player.maxHp}</span>
            </div>
            <Bar value={player.hp} max={player.maxHp} color={hpColor} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-1">
        {(Object.entries(player.stats) as [keyof Stats, number][]).map(([k, v]) => (
          <div key={k} className="border border-border bg-card p-2 text-center">
            <div className="text-muted-foreground text-[8px] tracking-wider uppercase">{k}</div>
            <div className="text-foreground text-base font-black leading-none mt-1">{v}</div>
          </div>
        ))}
      </div>

      {/* Deadline block */}
      <div className={`border-2 p-3 flex items-center justify-between ${
        urgent
          ? "border-destructive bg-destructive/5 shadow-[3px_3px_0_#FF3131]"
          : "border-accent bg-accent/5 shadow-[3px_3px_0_#FFEE00]"
      }`}>
        <div>
          <div className={`text-[10px] font-bold tracking-widest ${urgent ? "text-destructive" : "text-accent"}`}>
            DAILY DEADLINE
          </div>
          <div className="text-muted-foreground text-[10px] mt-0.5">
            {activeQuests.length} active · {doneToday} cleared today
          </div>
        </div>
        <div className={`text-2xl font-black tabular-nums ${urgent ? "text-destructive animate-pulse" : "text-accent"}`}>
          {fmtCountdown(ms)}
        </div>
      </div>

      {/* Active quests */}
      <div>
        <div className="flex justify-between text-[10px] text-muted-foreground tracking-wider mb-2">
          <span>ACTIVE QUESTS</span>
          <span>{activeQuests.length} PENDING</span>
        </div>
        {activeQuests.length === 0 ? (
          <div className="border-2 border-dashed border-border p-6 text-center text-muted-foreground text-[10px] tracking-wider">
            NO ACTIVE QUESTS<br />
            <span className="text-primary mt-1 block">→ ADD ONE IN QUEST_LOG</span>
          </div>
        ) : (
          <div className="space-y-2">
            {activeQuests.map(q => (
              <QuestRow key={q.id} quest={q} now={now} onTap={() => onQuestTap(q.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// QUESTS SCREEN
// ─────────────────────────────────────────────────────────────────
function QuestsScreen({
  quests, now, onQuestTap, onAdd,
}: {
  quests: Quest[]; now: number;
  onQuestTap: (id: string) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "done" | "failed">("all");

  const filtered = quests
    .filter(q => filter === "all" ? true : q.status === filter)
    .sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return b.createdAt - a.createdAt;
    });

  return (
    <div className="p-4 pb-24 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-foreground font-black text-xl tracking-[0.15em]">QUEST_LOG</h1>
        <button
          onClick={onAdd}
          className="border-2 border-primary text-primary p-2 shadow-[3px_3px_0_#00FF41] hover:shadow-[5px_5px_0_#00FF41] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 transition-all"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {(["all", "active", "done", "failed"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[9px] px-3 py-1.5 border shrink-0 tracking-widest transition-all ${
              filter === f
                ? "border-primary bg-primary text-primary-foreground font-black"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-border p-8 text-center space-y-3">
          <div className="text-muted-foreground text-[10px] tracking-wider">NO QUESTS FOUND</div>
          <button
            onClick={onAdd}
            className="border-2 border-primary text-primary text-[10px] px-4 py-2 tracking-widest hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            + DEPLOY NEW QUEST
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(q => (
            <QuestRow key={q.id} quest={q} now={now} onTap={() => onQuestTap(q.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// QUEST DETAIL (rendered as modal overlay)
// ─────────────────────────────────────────────────────────────────
function QuestDetailModal({
  quest, now, onClose, onComplete, onToggleObj,
}: {
  quest: Quest; now: number;
  onClose: () => void;
  onComplete: () => void;
  onToggleObj: (id: string) => void;
}) {
  const ms = quest.deadline - now;
  const expired = ms <= 0;
  const urgent = ms < 3_600_000 && !expired;
  const isDone = quest.status === "done";
  const isFailed = quest.status === "failed";
  const objsDone = quest.objectives.filter(o => o.done).length;
  const allDone = quest.objectives.length === 0 || objsDone === quest.objectives.length;
  const canComplete = quest.status === "active" && !expired && allDone;

  return (
    <div className="absolute inset-0 bg-background z-40 overflow-y-auto">
      <div className="p-4 space-y-3 pb-8">
        {/* Back */}
        <button onClick={onClose} className="flex items-center gap-2 text-muted-foreground text-[10px] tracking-widest hover:text-foreground transition-colors">
          <ChevronLeft size={14} />
          BACK TO QUEST_LOG
        </button>

        {/* Header */}
        <div className={`border-2 p-4 ${
          isDone   ? "border-primary shadow-[4px_4px_0_#00FF41]" :
          isFailed ? "border-destructive/50 bg-destructive/5" :
          urgent   ? "border-accent shadow-[4px_4px_0_#FFEE00]" :
          "border-border bg-card"
        }`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className={`text-[9px] tracking-[0.3em] ${
              isDone ? "text-primary" : isFailed ? "text-destructive" : "text-muted-foreground"
            }`}>
              {isDone ? "[COMPLETED]" : isFailed ? "[FAILED]" : "[ACTIVE]"}
            </div>
            <span className={`border px-2 py-0.5 text-[10px] font-bold shrink-0 ${RANK_COLOR[quest.rank]}`}>
              {quest.rank}-RANK
            </span>
          </div>
          <h2 className="text-foreground font-black text-lg leading-snug">{quest.title}</h2>
          {quest.description && (
            <p className="text-muted-foreground text-[11px] leading-relaxed mt-2">{quest.description}</p>
          )}
          <div className={`text-[10px] mt-2 font-bold ${CAT_COLOR[quest.category]}`}>{quest.category}</div>
        </div>

        {/* Deadline */}
        {!isDone && (
          <div className={`border-2 p-3 flex items-center justify-between ${
            isFailed || expired ? "border-destructive/50" :
            urgent ? "border-accent" : "border-border"
          }`}>
            <div>
              <div className="text-[9px] text-muted-foreground tracking-widest">DEADLINE</div>
              <div className="text-[11px] text-foreground mt-0.5">{fmtDeadlineTime(quest.deadline)}</div>
            </div>
            <div className={`text-xl font-black tabular-nums ${
              isFailed || expired ? "text-destructive" :
              urgent ? "text-accent animate-pulse" :
              "text-foreground"
            }`}>
              {isFailed || expired ? "EXPIRED" : fmtCountdown(ms)}
            </div>
          </div>
        )}

        {/* Objectives */}
        {quest.objectives.length > 0 && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-2">
              OBJECTIVES — {objsDone}/{quest.objectives.length}
            </div>
            <div className="space-y-1">
              {quest.objectives.map(obj => (
                <button
                  key={obj.id}
                  onClick={() => !isDone && !isFailed && onToggleObj(obj.id)}
                  disabled={isDone || isFailed}
                  className={`w-full text-left border p-3 flex items-center gap-3 transition-all ${
                    obj.done ? "border-primary/40 bg-primary/5" :
                    "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className={`w-4 h-4 border-2 flex items-center justify-center shrink-0 ${
                    obj.done ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}>
                    {obj.done && <Check size={10} className="text-primary-foreground" />}
                  </div>
                  <span className={`text-[11px] ${obj.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                    {obj.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reward / Penalty */}
        <div className="border border-border bg-card p-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          <div className="text-muted-foreground">Reward</div>
          <div className="text-primary font-bold">+{quest.xpReward} XP · +{quest.goldReward} GOLD</div>
          <div className="text-muted-foreground">Missed penalty</div>
          <div className="text-destructive font-bold">-{quest.hpPenalty} HP</div>
        </div>

        {/* CTA */}
        {!isDone && !isFailed && (
          <button
            onClick={onComplete}
            disabled={!canComplete}
            className={`w-full py-4 font-black text-[11px] tracking-[0.25em] border-2 transition-all ${
              canComplete
                ? "border-primary bg-primary text-primary-foreground shadow-[4px_4px_0_rgba(0,255,65,0.25)] hover:shadow-[6px_6px_0_rgba(0,255,65,0.35)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5"
                : "border-muted text-muted-foreground opacity-40 cursor-not-allowed"
            }`}
          >
            {expired       ? "[ DEADLINE HAS PASSED ]" :
             !allDone      ? `[ COMPLETE OBJECTIVES ${objsDone}/${quest.objectives.length} ]` :
             "[ MARK QUEST COMPLETE ]"}
          </button>
        )}
        {isDone && (
          <div className="w-full py-4 border-2 border-primary/30 text-center text-primary text-[11px] tracking-[0.25em] font-bold opacity-60">
            [ QUEST CLEARED ]
          </div>
        )}
        {isFailed && (
          <div className="w-full py-4 border-2 border-destructive/30 text-center text-destructive text-[11px] tracking-[0.25em] font-bold opacity-60">
            [ FAILED — {quest.hpPenalty} HP LOST ]
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SKILLS SCREEN
// ─────────────────────────────────────────────────────────────────
function SkillsScreen({ player, onAllocate }: { player: Player; onAllocate: (s: keyof Stats) => void }) {
  const STAT_LABELS: Record<keyof Stats, [string, string]> = {
    str: ["STRENGTH",     "Physical power"],
    int: ["INTELLIGENCE", "Mental capacity"],
    wis: ["WISDOM",       "Judgment"],
    dex: ["DEXTERITY",    "Skill & craft"],
    fth: ["FAITH",        "Spiritual discipline"],
    cha: ["CHARISMA",     "Social influence"],
  };
  const maxStat = Math.max(...Object.values(player.stats), 10);

  return (
    <div className="p-4 space-y-3 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-foreground font-black text-xl tracking-[0.15em]">ATTRIBUTES</h1>
        {player.unallocated > 0 && (
          <div className="border-2 border-accent text-accent text-[10px] px-2 py-1 font-bold tracking-widest shadow-[3px_3px_0_#FFEE00] animate-pulse">
            {player.unallocated} PTS FREE
          </div>
        )}
      </div>

      <div className="space-y-2">
        {(Object.entries(player.stats) as [keyof Stats, number][]).map(([stat, val]) => (
          <div key={stat} className="border-2 border-border bg-card p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-foreground font-bold text-[10px] tracking-wider">{STAT_LABELS[stat][0]}</span>
                <span className="text-muted-foreground text-[9px] ml-2 uppercase">({stat})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-foreground font-black text-lg w-8 text-right tabular-nums">{val}</span>
                {player.unallocated > 0 && (
                  <button
                    onClick={() => onAllocate(stat)}
                    className="border border-accent text-accent w-6 h-6 flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <Plus size={11} />
                  </button>
                )}
              </div>
            </div>
            <Bar value={val} max={maxStat + 2} />
            <div className="text-[9px] text-muted-foreground mt-1">{STAT_LABELS[stat][1]}</div>
          </div>
        ))}
      </div>

      {player.perks.length > 0 ? (
        <div>
          <div className="text-[9px] text-muted-foreground tracking-widest mb-2">UNLOCKED PERKS</div>
          <div className="grid grid-cols-2 gap-2">
            {player.perks.map(p => (
              <div key={p.id} className="border-2 border-primary/40 bg-card p-3 shadow-[2px_2px_0_rgba(0,255,65,0.15)]">
                <div className="text-primary text-[10px] font-bold tracking-wider">{p.name}</div>
                <div className="text-muted-foreground text-[9px] mt-1 leading-relaxed">{p.description}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-2 border-dashed border-border p-5 text-center text-muted-foreground text-[10px] tracking-wider">
          COMPLETE QUESTS TO UNLOCK PERKS
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOOT SCREEN
// ─────────────────────────────────────────────────────────────────
function LootScreen({ player, quests }: { player: Player; quests: Quest[] }) {
  const done = quests.filter(q => q.status === "done");
  const failed = quests.filter(q => q.status === "failed");
  const totalXp = done.reduce((s, q) => s + q.xpReward, 0);
  const totalHpLost = failed.reduce((s, q) => s + q.hpPenalty, 0);

  return (
    <div className="p-4 space-y-3 pb-24">
      <h1 className="text-foreground font-black text-xl tracking-[0.15em]">LOOT_LOG</h1>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2">
        <div className="border-2 border-primary bg-card p-3 text-center shadow-[3px_3px_0_#00FF41]">
          <div className="text-primary font-black text-2xl tabular-nums">{done.length}</div>
          <div className="text-muted-foreground text-[9px] tracking-wider mt-1">CLEARED</div>
        </div>
        <div className="border-2 border-accent bg-card p-3 text-center shadow-[3px_3px_0_#FFEE00]">
          <div className="text-accent font-black text-2xl tabular-nums">{totalXp}</div>
          <div className="text-muted-foreground text-[9px] tracking-wider mt-1">XP EARNED</div>
        </div>
        <div className="border-2 border-orange-500 bg-card p-3 text-center shadow-[3px_3px_0_#FB923C]">
          <div className="text-orange-400 font-black text-2xl tabular-nums">{player.gold}</div>
          <div className="text-muted-foreground text-[9px] tracking-wider mt-1">GOLD</div>
        </div>
      </div>

      {/* Failures summary */}
      {failed.length > 0 && (
        <div className="border-2 border-destructive/40 bg-destructive/5 p-3">
          <div className="text-destructive text-[10px] font-bold tracking-wider">FAILURES</div>
          <div className="text-muted-foreground text-[10px] mt-1">
            {failed.length} quests failed · {totalHpLost} HP lost total
          </div>
        </div>
      )}

      {done.length === 0 ? (
        <div className="border-2 border-dashed border-border p-8 text-center text-muted-foreground text-[10px] tracking-wider">
          COMPLETE QUESTS TO COLLECT LOOT
        </div>
      ) : (
        <div className="space-y-2">
          {done
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
            .map(q => (
              <div key={q.id} className="border border-primary/25 bg-card p-3 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-foreground">{q.title}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    <span className={CAT_COLOR[q.category]}>{q.category}</span> · {q.rank}-RANK ·{" "}
                    {q.completedAt ? new Date(q.completedAt).toLocaleDateString() : ""}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-primary text-[10px] font-bold">+{q.xpReward} XP</div>
                  <div className="text-orange-400 text-[9px]">+{q.goldReward} GOLD</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// PROFILE SCREEN
// ─────────────────────────────────────────────────────────────────
function ProfileScreen({
  player, quests, onReset,
}: { player: Player; quests: Quest[]; onReset: () => void }) {
  const done = quests.filter(q => q.status === "done").length;
  const failed = quests.filter(q => q.status === "failed").length;
  const rate = quests.length > 0 ? Math.round((done / quests.length) * 100) : 0;
  const hpPct = player.hp / player.maxHp;
  const hpColor = hpPct > 0.6 ? "bg-primary" : hpPct > 0.3 ? "bg-accent" : "bg-destructive";

  return (
    <div className="p-4 space-y-3 pb-24">
      {/* Character card */}
      <div className="border-2 border-primary bg-card p-4 shadow-[4px_4px_0_#00FF41] flex items-center gap-4">
        <div className="border-2 border-primary p-3 shrink-0">
          <Skull size={32} className="text-primary" />
        </div>
        <div>
          <div className="text-primary font-black text-lg tracking-[0.15em]">{player.codename}</div>
          <div className="text-muted-foreground text-[9px] tracking-widest">
            TITLE: &apos;{player.title}&apos;
          </div>
          <div className="text-muted-foreground text-[9px]">SINCE: {player.joinDate}</div>
        </div>
      </div>

      {/* Level row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          ["LVL " + player.level, "LEVEL", "text-primary"],
          [player.totalXp, "TOTAL XP", "text-accent"],
          [player.streak + "D", "STREAK", "text-orange-400"],
        ].map(([val, label, color]) => (
          <div key={label as string} className="border-2 border-border bg-card p-3 text-center">
            <div className={`font-black text-xl tabular-nums ${color}`}>{val}</div>
            <div className="text-muted-foreground text-[9px] tracking-wider mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* HP */}
      <div className="border-2 border-border bg-card p-3">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-muted-foreground tracking-wider">SYSTEM INTEGRITY</span>
          <span className={hpPct < 0.3 ? "text-destructive font-bold" : "text-foreground"}>
            {player.hp}/{player.maxHp} HP
          </span>
        </div>
        <Bar value={player.hp} max={player.maxHp} color={hpColor} />
        {hpPct < 0.3 && (
          <div className="text-destructive text-[9px] mt-2 animate-pulse tracking-wider">
            ⚠ CRITICAL — COMPLETE QUESTS TO RESTORE
          </div>
        )}
      </div>

      {/* Quest record */}
      <div className="border-2 border-border bg-card p-3">
        <div className="text-[9px] text-muted-foreground tracking-widest mb-3">MISSION RECORD</div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          {[
            ["COMPLETED", done, "text-primary"],
            ["FAILED", failed, "text-destructive"],
            ["SUCCESS RATE", rate + "%", rate >= 70 ? "text-primary" : rate >= 40 ? "text-accent" : "text-destructive"],
            ["GOLD", player.gold, "text-orange-400"],
          ].map(([label, val, color]) => (
            <div key={label as string} className="flex justify-between border-b border-border pb-1">
              <span className="text-muted-foreground">{label}</span>
              <span className={`font-bold ${color}`}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Attributes */}
      <div className="border-2 border-border bg-card p-3">
        <div className="text-[9px] text-muted-foreground tracking-widest mb-3">ATTRIBUTE MATRIX</div>
        <div className="grid grid-cols-3 gap-3">
          {(Object.entries(player.stats) as [keyof Stats, number][]).map(([k, v]) => (
            <div key={k} className="text-center">
              <div className="text-foreground font-black text-xl tabular-nums">{v}</div>
              <div className="text-muted-foreground text-[9px] tracking-wider">{k.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={onReset}
        className="w-full border-2 border-destructive/40 text-destructive/60 text-[10px] py-3 flex items-center justify-center gap-2 tracking-widest hover:border-destructive hover:text-destructive transition-colors"
      >
        <RotateCcw size={12} /> RESET ALL DATA
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// BOTTOM NAV
// ─────────────────────────────────────────────────────────────────
function BottomNav({ screen, nav }: { screen: Screen; nav: (s: Screen) => void }) {
  const TABS: { id: Screen; Icon: typeof LayoutGrid; label: string }[] = [
    { id: "home",    Icon: LayoutGrid, label: "HOME" },
    { id: "quests",  Icon: Swords,     label: "QUESTS" },
    { id: "skills",  Icon: TrendingUp, label: "SKILLS" },
    { id: "loot",    Icon: Package,    label: "LOOT" },
    { id: "profile", Icon: User,       label: "PROFILE" },
  ];

  return (
    <div className="border-t-2 border-border bg-card grid grid-cols-5 shrink-0">
      {TABS.map(({ id, Icon, label }) => (
        <button
          key={id}
          onClick={() => nav(id)}
          className={`flex flex-col items-center gap-1 py-3 transition-colors relative ${
            screen === id
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {screen === id && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
          )}
          <Icon size={18} />
          <span className="text-[8px] tracking-[0.15em]">{label}</span>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADD QUEST MODAL
// ─────────────────────────────────────────────────────────────────
function AddQuestModal({ onAdd, onClose, now }: {
  onAdd: (data: Omit<Quest, "id" | "status" | "createdAt">) => void;
  onClose: () => void;
  now: number;
}) {
  const [title, setTitle]           = useState("");
  const [description, setDesc]      = useState("");
  const [category, setCategory]     = useState<QuestCategory>("BODY");
  const [rank, setRank]             = useState<QuestRank>("C");
  const [deadlineH, setDeadlineH]   = useState("23");
  const [deadlineM, setDeadlineM]   = useState("59");
  const [objectives, setObjectives] = useState<string[]>([]);
  const [newObj, setNewObj]         = useState("");

  const addObj = () => {
    const t = newObj.trim();
    if (t) { setObjectives(p => [...p, t]); setNewObj(""); }
  };

  const submit = () => {
    if (!title.trim()) return;
    const dl = new Date();
    const h = Math.min(23, Math.max(0, parseInt(deadlineH) || 23));
    const m = Math.min(59, Math.max(0, parseInt(deadlineM) || 59));
    dl.setHours(h, m, 0, 0);
    if (dl.getTime() <= now) dl.setDate(dl.getDate() + 1);

    onAdd({
      title: title.trim(),
      description: description.trim(),
      category,
      rank,
      xpReward: RANK_XP[rank],
      goldReward: RANK_GOLD[rank],
      hpPenalty: RANK_HP[rank],
      deadline: dl.getTime(),
      objectives: objectives.map(t => ({ id: uid(), text: t, done: false })),
    });
  };

  return (
    <div className="absolute inset-0 bg-background z-40 overflow-y-auto">
      <div className="p-4 space-y-4 pb-8">
        <div className="flex items-center justify-between">
          <h2 className="text-foreground font-black text-lg tracking-[0.15em]">NEW QUEST</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Title */}
        <Field label="QUEST TITLE *">
          <input
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What must be done..."
            className="w-full bg-card border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
          />
        </Field>

        {/* Description */}
        <Field label="DESCRIPTION">
          <textarea
            value={description}
            onChange={e => setDesc(e.target.value)}
            placeholder="Optional context..."
            rows={2}
            className="w-full bg-card border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none resize-none transition-colors placeholder:text-muted-foreground"
          />
        </Field>

        {/* Category + Rank */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="CATEGORY">
            <select
              value={category}
              onChange={e => setCategory(e.target.value as QuestCategory)}
              className="w-full bg-card border-2 border-border text-foreground text-xs p-3 outline-none focus:border-primary appearance-none"
            >
              {(["BODY", "MIND", "SPIRIT", "CRAFT", "WEALTH"] as QuestCategory[]).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="RANK">
            <select
              value={rank}
              onChange={e => setRank(e.target.value as QuestRank)}
              className="w-full bg-card border-2 border-border text-foreground text-xs p-3 outline-none focus:border-primary appearance-none"
            >
              {(["S", "A", "B", "C", "D", "E"] as QuestRank[]).map(r => (
                <option key={r} value={r}>{r} — +{RANK_XP[r]}XP / -{RANK_HP[r]}HP</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Deadline */}
        <Field label="DEADLINE (HH:MM, TODAY)">
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="23" value={deadlineH}
              onChange={e => setDeadlineH(e.target.value)}
              className="w-16 bg-card border-2 border-border text-foreground text-sm p-3 outline-none text-center focus:border-primary tabular-nums"
            />
            <span className="text-foreground font-bold text-lg">:</span>
            <input
              type="number" min="0" max="59" value={deadlineM}
              onChange={e => setDeadlineM(e.target.value)}
              className="w-16 bg-card border-2 border-border text-foreground text-sm p-3 outline-none text-center focus:border-primary tabular-nums"
            />
          </div>
        </Field>

        {/* Objectives */}
        <Field label="OBJECTIVES">
          <div className="space-y-2">
            {objectives.map((obj, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] border border-primary/30 bg-card p-2">
                <Check size={10} className="text-primary shrink-0" />
                <span className="flex-1 text-foreground">{obj}</span>
                <button onClick={() => setObjectives(p => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X size={12} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={newObj}
                onChange={e => setNewObj(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addObj()}
                placeholder="Add an objective..."
                className="flex-1 bg-card border border-border focus:border-primary text-foreground text-xs p-2 outline-none placeholder:text-muted-foreground transition-colors"
              />
              <button
                onClick={addObj}
                className="border border-primary text-primary px-3 hover:bg-primary hover:text-primary-foreground transition-colors text-xs"
              >
                ADD
              </button>
            </div>
          </div>
        </Field>

        {/* Preview */}
        <div className="border border-dashed border-border p-3 text-[10px] space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Success reward</span>
            <span className="text-primary font-bold">+{RANK_XP[rank]} XP · +{RANK_GOLD[rank]} GOLD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Failure penalty</span>
            <span className="text-destructive font-bold">-{RANK_HP[rank]} HP</span>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!title.trim()}
          className={`w-full py-4 font-black text-[11px] tracking-[0.25em] border-2 transition-all ${
            title.trim()
              ? "border-primary bg-primary text-primary-foreground shadow-[4px_4px_0_rgba(0,255,65,0.25)] hover:shadow-[6px_6px_0_rgba(0,255,65,0.35)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5"
              : "border-muted text-muted-foreground opacity-40 cursor-not-allowed"
          }`}
        >
          [ DEPLOY QUEST ]
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-muted-foreground tracking-[0.3em] mb-1">{label}</div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// AI GENERATE MODAL
// ─────────────────────────────────────────────────────────────────
function AiGenerateModal({
  profile,
  onChange,
  onClose,
  onGenerate,
  isGenerating,
  error,
}: {
  profile: AIProfile;
  onChange: (profile: AIProfile) => void;
  onClose: () => void;
  onGenerate: (profile: AIProfile) => void | Promise<void>;
  isGenerating: boolean;
  error: string;
}) {
  const [weatherLookup, setWeatherLookup] = useState<WeatherLookup>({ label: profile.weather || "Not loaded", isLoading: false, error: "" });

  const setField = (key: keyof AIProfile, value: string) => {
    onChange({ ...profile, [key]: value });
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const region = profile.region.trim();
      if (!region) {
        setWeatherLookup({ label: "Enter a region to fetch weather", isLoading: false, error: "" });
        return;
      }

      setWeatherLookup({ label: profile.weather || "Fetching weather...", isLoading: true, error: "" });
      try {
        const weather = await fetchWeatherForRegion(region);
        if (cancelled) return;
        setWeatherLookup({ label: weather, isLoading: false, error: "" });
        onChange({ ...profile, weather });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Weather lookup failed.";
        setWeatherLookup({ label: profile.weather || "Weather unavailable", isLoading: false, error: message });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [onChange, profile.region]);

  const submit = () => {
    onGenerate(profile);
  };

  return (
    <div className="absolute inset-0 bg-background z-40 overflow-y-auto">
      <div className="min-h-full p-4 pb-8 flex items-start justify-center">
        <div className="w-full max-w-[540px] space-y-4">
          <div className="border-2 border-primary bg-card p-4 shadow-[6px_6px_0_rgba(0,255,65,0.18)] animate-[fade-in_0.35s_ease]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-primary font-black text-2xl tracking-[0.35em]">PROFILE SCAN</div>
                <div className="text-muted-foreground text-[10px] tracking-[0.25em] mt-1">BOOT SEQUENCE CONTINUES. FEED THE GENERATOR SIGNALS.</div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="mt-3 border border-border bg-background/80 px-3 py-2 text-[10px] tracking-[0.2em] uppercase flex items-center justify-between gap-2">
              <span>WEATHER SIGNAL</span>
              <span className="text-primary font-bold truncate text-right">
                {weatherLookup.isLoading ? "SYNCING..." : weatherLookup.label}
              </span>
            </div>
            <div className="mt-1 text-[9px] text-muted-foreground tracking-[0.2em] uppercase">
              {weatherLookup.error ? weatherLookup.error : "AUTO-FETCHED FROM REGION"}
            </div>
          </div>

          <div className="border-2 border-border bg-card p-4 space-y-4 shadow-[4px_4px_0_rgba(255,255,255,0.04)]">
            <div className="border border-primary/30 bg-primary/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
              Your academics lead the batch, followed by faith and interests. Add your next exam date to unlock one extra, focused study quest during the final 30 days; wellness quests stay in the batch.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="AGE">
                <input
                  type="text"
                  value={profile.age}
                  onChange={e => setField("age", e.target.value)}
                  className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                  placeholder="28"
                />
              </Field>
              <Field label="HEIGHT">
                <input
                  type="text"
                  value={profile.height}
                  onChange={e => setField("height", e.target.value)}
                  className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                  placeholder={'5\'10"'}
                />
              </Field>
            </div>

            <Field label="ACADEMICS">
              <input
                type="text"
                value={profile.academics}
                onChange={e => setField("academics", e.target.value)}
                className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                placeholder="School, degree, or study focus"
              />
            </Field>

            <Field label="NEXT EXAM DATE (OPTIONAL)">
              <input
                type="date"
                value={profile.nextExam}
                onChange={e => setField("nextExam", e.target.value)}
                className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors"
              />
              <div className="mt-1 text-[9px] text-muted-foreground tracking-wide">EXAM PREP MODE ACTIVATES 30 DAYS BEFORE THIS DATE</div>
            </Field>

            <Field label="OCCUPATION">
              <input
                type="text"
                value={profile.occupation}
                onChange={e => setField("occupation", e.target.value)}
                className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                placeholder="Job, role, or main work"
              />
            </Field>

            <Field label="INTEREST">
              <input
                type="text"
                value={profile.interest}
                onChange={e => setField("interest", e.target.value)}
                className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                placeholder="Gym, art, coding, music..."
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="FAITH">
                <input
                  type="text"
                  value={profile.faith}
                  onChange={e => setField("faith", e.target.value)}
                  className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                  placeholder="Optional"
                />
              </Field>
              <Field label="REGION">
                <input
                  type="text"
                  value={profile.region}
                  onChange={e => setField("region", e.target.value)}
                  className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                  placeholder="City, state, country"
                />
              </Field>
            </div>

            <Field label="NOTES">
              <input
                type="text"
                value={profile.notes}
                onChange={e => setField("notes", e.target.value)}
                className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none transition-colors placeholder:text-muted-foreground"
                placeholder="Anything extra"
              />
            </Field>

            <button
              disabled={isGenerating}
              onClick={submit}
              className="w-full py-4 font-black text-[11px] tracking-[0.3em] border-2 border-primary bg-primary text-primary-foreground shadow-[4px_4px_0_rgba(0,255,65,0.25)] hover:shadow-[6px_6px_0_rgba(0,255,65,0.35)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 transition-all disabled:opacity-50"
            >
              {isGenerating ? "[ GENERATING... ]" : "[ GENERATE QUEST BATCH ]"}
            </button>
            {error && <div className="border border-destructive/50 bg-destructive/10 p-3 text-[10px] text-destructive leading-relaxed">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// LEVEL UP MODAL
// ─────────────────────────────────────────────────────────────────
function AiBatchReviewModal({ batch, onChange, onDeploy, onBack }: {
  batch: QuestDraft[];
  onChange: (batch: QuestDraft[]) => void;
  onDeploy: () => void;
  onBack: () => void;
}) {
  const updateQuest = (index: number, update: Partial<QuestDraft>) => {
    onChange(batch.map((quest, questIndex) => questIndex === index ? { ...quest, ...update } : quest));
  };

  const updateRank = (index: number, rank: QuestRank) => {
    updateQuest(index, { rank, xpReward: RANK_XP[rank], goldReward: RANK_GOLD[rank], hpPenalty: RANK_HP[rank] });
  };

  const discardQuest = (index: number) => onChange(batch.filter((_, questIndex) => questIndex !== index));

  return (
    <div className="absolute inset-0 bg-background z-40 overflow-y-auto">
      <div className="min-h-full p-4 pb-8 flex items-start justify-center">
        <div className="w-full max-w-[540px] space-y-4">
          <div className="border-2 border-primary bg-card p-4 shadow-[6px_6px_0_rgba(0,255,65,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-primary font-black text-xl tracking-[0.2em]">REVIEW QUEST BATCH</div>
                <div className="text-muted-foreground text-[10px] tracking-[0.12em] mt-1">SET EACH TITLE, DIFFICULTY, AND DEADLINE BEFORE DEPLOYING.</div>
              </div>
              <button onClick={onBack} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><ChevronLeft size={20} /></button>
            </div>
          </div>

          {batch.map((quest, index) => (
            <div key={`${quest.title}-${index}`} className="border-2 border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] text-primary font-bold tracking-[0.2em]">QUEST {index + 1} · {quest.category}</div>
                <button
                  onClick={() => discardQuest(index)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive tracking-wider transition-colors"
                  aria-label={`Discard ${quest.title}`}
                >
                  <X size={14} /> DISCARD
                </button>
              </div>
              <Field label="TASK TITLE">
                <input
                  value={quest.title}
                  onChange={e => updateQuest(index, { title: e.target.value })}
                  className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="DIFFICULTY">
                  <select
                    value={quest.rank}
                    onChange={e => updateRank(index, e.target.value as QuestRank)}
                    className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none"
                  >
                    {(["S", "A", "B", "C", "D", "E"] as QuestRank[]).map(rank => <option key={rank} value={rank}>{rank}-RANK</option>)}
                  </select>
                </Field>
                <Field label="DEADLINE">
                  <input
                    type="datetime-local"
                    value={datetimeLocalValue(quest.deadline)}
                    onChange={e => {
                      const deadline = new Date(e.target.value).getTime();
                      if (!Number.isNaN(deadline)) updateQuest(index, { deadline });
                    }}
                    className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none"
                  />
                </Field>
              </div>
              <div className="text-[10px] text-muted-foreground">+{quest.xpReward} XP · +{quest.goldReward} GOLD · −{quest.hpPenalty} HP ON MISS</div>
            </div>
          ))}

          <button disabled={batch.length === 0} onClick={onDeploy} className="w-full py-4 font-black text-[11px] tracking-[0.3em] border-2 border-primary bg-primary text-primary-foreground shadow-[4px_4px_0_rgba(0,255,65,0.25)] disabled:opacity-40 disabled:cursor-not-allowed">
            [ DEPLOY {batch.length} REVIEWED QUEST{batch.length === 1 ? "" : "S"} ]
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// LEVEL UP MODAL
// ─────────────────────────────────────────────────────────────────
function LevelUpModal({ player, oldLevel, onClose }: {
  player: Player; oldLevel: number; onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 bg-background/98 z-50 flex items-center justify-center p-5">
      <div className="w-full max-w-[360px] space-y-3">
        <div className="border-2 border-primary bg-primary p-5 text-center shadow-[6px_6px_0_rgba(0,255,65,0.3)]">
          <div className="text-primary-foreground font-black text-4xl tracking-[0.2em]">LEVEL UP!</div>
          <div className="text-primary-foreground/70 text-[10px] tracking-[0.3em] mt-1">BEAST ENGINE ENHANCED</div>
        </div>

        <div className="border-2 border-border bg-card p-6 text-center">
          <div className="text-muted-foreground text-[9px] tracking-widest">NEW TIER</div>
          <div className="text-accent font-black text-7xl tabular-nums mt-2">{player.level}</div>
          <div className="text-foreground text-sm tracking-[0.2em] mt-2">{player.title}</div>
        </div>

        <div className="border border-border bg-card p-3 text-center">
          <div className="text-muted-foreground text-[10px] italic leading-relaxed">
            "The pain of discipline is nothing compared to the pain of regret."
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full border-2 border-primary bg-primary text-primary-foreground font-black py-4 text-[11px] tracking-[0.3em] shadow-[4px_4px_0_rgba(0,255,65,0.25)] hover:shadow-[6px_6px_0_rgba(0,255,65,0.35)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 transition-all"
        >
          [ ACKNOWLEDGE PROGRESS ]
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// PENALTY MODAL
// ─────────────────────────────────────────────────────────────────
function PenaltyModal({
  failedQuests, totalHpLost, player, onClose,
}: {
  failedQuests: Quest[]; totalHpLost: number; player: Player; onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 bg-background/98 z-50 flex items-center justify-center p-5">
      <div className="w-full max-w-[360px] space-y-3">
        <div className="border-2 border-destructive bg-destructive/10 p-4 text-center shadow-[6px_6px_0_#FF3131]">
          <AlertTriangle size={28} className="text-destructive mx-auto mb-2" />
          <div className="text-destructive font-black text-2xl tracking-[0.15em]">DEADLINE BREACH</div>
          <div className="text-muted-foreground text-[9px] tracking-[0.3em] mt-1">PENALTY PROTOCOL ACTIVATED</div>
        </div>

        <div className="space-y-1.5">
          {failedQuests.map(q => (
            <div key={q.id} className="border border-destructive/40 bg-card p-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-foreground">{q.title}</div>
                <div className="text-[9px] text-muted-foreground">{q.rank}-RANK · {q.category}</div>
              </div>
              <div className="text-destructive text-[11px] font-black">-{q.hpPenalty} HP</div>
            </div>
          ))}
        </div>

        <div className="border-2 border-destructive p-3 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground tracking-wider">TOTAL DAMAGE</span>
          <span className="text-destructive font-black text-2xl tabular-nums">-{totalHpLost} HP</span>
        </div>

        <div className="text-[10px] text-center text-muted-foreground">
          Remaining: <span className={player.hp < 30 ? "text-destructive font-bold" : "text-foreground font-bold"}>
            {player.hp}/{player.maxHp} HP
          </span>
          {player.hp < 30 && (
            <span className="text-destructive block animate-pulse mt-1 tracking-wider">
              ⚠ CRITICAL INTEGRITY
            </span>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full border-2 border-destructive text-destructive font-black py-4 text-[11px] tracking-[0.3em] hover:bg-destructive hover:text-destructive-foreground transition-colors"
        >
          [ ACKNOWLEDGE FAILURE ]
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// CONFIRM RESET MODAL
// ─────────────────────────────────────────────────────────────────
function ConfirmResetModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 bg-background/98 z-50 flex items-center justify-center p-5">
      <div className="w-full max-w-[340px] space-y-4 border-2 border-destructive bg-card p-5 shadow-[6px_6px_0_#FF3131]">
        <div className="text-destructive font-black text-lg tracking-[0.15em]">RESET SYSTEM?</div>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          This will permanently delete your character, all quests, and progress. This cannot be undone.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="border-2 border-border text-foreground text-[11px] py-3 font-bold tracking-widest hover:border-primary hover:text-primary transition-colors"
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="border-2 border-destructive bg-destructive text-destructive-foreground text-[11px] py-3 font-black tracking-widest hover:bg-destructive/80 transition-colors"
          >
            WIPE DATA
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────
function ApiSetupScreen({ onConnect }: { onConnect: (connection: AIConnection) => void }) {
  const [provider, setProvider] = useState<AIProvider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-3.5-flash");
  const submit = () => {
    if (!apiKey.trim() || !model.trim()) return;
    onConnect({ provider, apiKey: apiKey.trim(), model: model.trim() });
  };
  return (
    <div className="bg-background text-foreground min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[430px] border-2 border-primary bg-card p-5 space-y-4 shadow-[6px_6px_0_rgba(0,255,65,0.18)]">
        <div>
          <div className="text-primary font-black text-2xl tracking-[0.25em]">AI ACCESS REQUIRED</div>
          <p className="text-muted-foreground text-[11px] leading-relaxed mt-2">Taskmaster uses your chosen AI provider to create tasks. Connect your own key to enter.</p>
        </div>
        <Field label="PROVIDER">
          <select value={provider} onChange={e => { const next = e.target.value as AIProvider; setProvider(next); setModel(next === "openai" ? "gpt-5" : "gemini-3.5-flash"); }} className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none">
            <option value="gemini">Google Gemini / AI Studio</option>
            <option value="openai">OpenAI</option>
          </select>
        </Field>
        <Field label="MODEL">
          <input value={model} onChange={e => setModel(e.target.value)} className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none" />
        </Field>
        <Field label="API KEY">
          <input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter your own key" className="w-full bg-background border-2 border-border focus:border-primary text-foreground text-sm p-3 outline-none" />
        </Field>
        <p className="text-[9px] text-muted-foreground leading-relaxed">The key is saved only in this device's browser storage so the app remains connected. Use a restricted personal key and remove site data to disconnect.</p>
        <button disabled={!apiKey.trim() || !model.trim()} onClick={submit} className="w-full py-4 font-black text-[11px] tracking-[0.25em] border-2 border-primary bg-primary text-primary-foreground disabled:opacity-40">[ CONNECT & ENTER ]</button>
      </div>
    </div>
  );
}

export default function App() {
  const [player, setPlayer]       = useState<Player | null>(null);
  const [quests, setQuests]       = useState<Quest[]>([]);
  const [screen, setScreen]       = useState<Screen>("home");
  const [modal, setModal]         = useState<Modal>(null);
  const [detailId, setDetailId]   = useState<string | null>(null);
  const [now, setNow]             = useState(Date.now());
  const [levelUpFrom, setLevelUpFrom] = useState<number | null>(null);
  const [penaltyData, setPenaltyData] = useState<{ quests: Quest[]; hp: number } | null>(null);
  const [aiProfile, setAiProfile] = useState<AIProfile>(() => {
    try {
      const raw = localStorage.getItem(AI_KEY);
      return raw ? { ...DEFAULT_AI_PROFILE, ...JSON.parse(raw) } : DEFAULT_AI_PROFILE;
    } catch {
      return DEFAULT_AI_PROFILE;
    }
  });
  const [draftBatch, setDraftBatch] = useState<QuestDraft[]>([]);
  const [aiConnection, setAiConnection] = useState<AIConnection | null>(() => {
    try { const raw = localStorage.getItem(AI_CONNECTION_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [aiError, setAiError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const penalizedRef = useRef<Set<string>>(new Set());

  // ── Persistence helpers ────────────────────────
  const savePlayer = useCallback((p: Player) => {
    localStorage.setItem(P_KEY, JSON.stringify(p));
    setPlayer(p);
  }, []);

  const saveQuests = useCallback((q: Quest[]) => {
    localStorage.setItem(Q_KEY, JSON.stringify(q));
    setQuests(q);
  }, []);

  useEffect(() => {
    localStorage.setItem(AI_KEY, JSON.stringify(aiProfile));
  }, [aiProfile]);

  // ── Load on mount ──────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(P_KEY);
    const rawQ = localStorage.getItem(Q_KEY);
    const rawP = localStorage.getItem(PEN_KEY);

    if (rawP) {
      const ids: string[] = JSON.parse(rawP);
      ids.forEach(id => penalizedRef.current.add(id));
    }

    if (rawQ) setQuests(JSON.parse(rawQ));

    if (raw) {
      const p: Player = JSON.parse(raw);
      const today = todayStr();
      if (p.lastCheckIn !== today) {
        const prev = new Date(p.lastCheckIn);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const isConsecutive = prev.toISOString().slice(0, 10) === yesterday.toISOString().slice(0, 10);
        const streak = isConsecutive ? p.streak + 1 : 0;
        savePlayer({ ...p, streak, lastCheckIn: today });
      } else {
        setPlayer(p);
      }
    }
  }, [savePlayer]);

  // ── Clock ───────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Deadline enforcement ────────────────────────
  useEffect(() => {
    if (!player) return;
    const active = quests.filter(q => q.status === "active");
    const failed = active.filter(q => now > q.deadline && !penalizedRef.current.has(q.id));
    if (failed.length === 0) return;

    failed.forEach(q => penalizedRef.current.add(q.id));
    localStorage.setItem(PEN_KEY, JSON.stringify([...penalizedRef.current]));

    const totalHp = failed.reduce((s, q) => s + q.hpPenalty, 0);
    const newHp = Math.max(0, player.hp - totalHp);

    saveQuests(quests.map(q => failed.find(f => f.id === q.id) ? { ...q, status: "failed" as QuestStatus } : q));
    savePlayer({ ...player, hp: newHp });
    setPenaltyData({ quests: failed, hp: totalHp });
    setModal("penalty");
  }, [now, quests, player, savePlayer, saveQuests]);

  // ── Check perks ─────────────────────────────────
  const checkPerks = useCallback((p: Player, allQuests: Quest[]) => {
    const done = allQuests.filter(q => q.status === "done");
    const newPerks = [...p.perks];
    const has = (id: string) => newPerks.some(pk => pk.id === id);

    if (!has("first_blood") && done.length >= 1)  newPerks.push({ ...PERKS_DB.first_blood });
    if (!has("ten_quests")  && done.length >= 10) newPerks.push({ ...PERKS_DB.ten_quests });
    if (!has("s_rank") && done.some(q => q.rank === "S")) newPerks.push({ ...PERKS_DB.s_rank });
    if (!has("streak_7") && p.streak >= 7) newPerks.push({ ...PERKS_DB.streak_7 });
    if (!has("lvl5")  && p.level >= 5)  newPerks.push({ ...PERKS_DB.lvl5 });
    if (!has("lvl10") && p.level >= 10) newPerks.push({ ...PERKS_DB.lvl10 });

    return newPerks.length !== p.perks.length ? { ...p, perks: newPerks } : p;
  }, []);

  // ── Complete quest ──────────────────────────────
  const completeQuest = useCallback((questId: string) => {
    if (!player) return;
    const quest = quests.find(q => q.id === questId);
    if (!quest || quest.status !== "active") return;
    const allDone = quest.objectives.length === 0 || quest.objectives.every(o => o.done);
    if (!allDone || now > quest.deadline) return;

    const updatedQuests = quests.map(q =>
      q.id === questId ? { ...q, status: "done" as QuestStatus, completedAt: Date.now() } : q
    );

    let newXp = player.xp + quest.xpReward;
    let lvl = player.level;
    const oldLevel = lvl;

    while (newXp >= XP_FOR_LEVEL(lvl)) {
      newXp -= XP_FOR_LEVEL(lvl);
      lvl++;
    }

    const leveled = lvl > oldLevel;
    const healHp = Math.min(player.maxHp, player.hp + 10);

    let updated: Player = {
      ...player,
      xp: newXp,
      totalXp: player.totalXp + quest.xpReward,
      gold: player.gold + quest.goldReward,
      level: lvl,
      title: CLASS_FOR(lvl),
      hp: healHp,
      unallocated: player.unallocated + (leveled ? 2 : 0),
    };

    updated = checkPerks(updated, updatedQuests);

    saveQuests(updatedQuests);
    savePlayer(updated);

    if (leveled) {
      setLevelUpFrom(oldLevel);
      setModal("level-up");
    } else {
      setModal(null);
      setDetailId(null);
    }
  }, [player, quests, now, checkPerks, savePlayer, saveQuests]);

  // ── Toggle objective ────────────────────────────
  const toggleObj = useCallback((questId: string, objId: string) => {
    saveQuests(quests.map(q =>
      q.id !== questId ? q :
      { ...q, objectives: q.objectives.map(o => o.id === objId ? { ...o, done: !o.done } : o) }
    ));
  }, [quests, saveQuests]);

  // ── Add quest ───────────────────────────────────
  const addQuest = useCallback((data: Omit<Quest, "id" | "status" | "createdAt">) => {
    const quest: Quest = { ...data, id: uid(), status: "active", createdAt: Date.now() };
    saveQuests([...quests, quest]);
    setModal(null);
  }, [quests, saveQuests]);

  const addGeneratedQuests = useCallback((generated: Omit<Quest, "id" | "status" | "createdAt">[]) => {
    const manualQuests = quests.filter(q => q.generatedBy !== "ai" && !q.description.startsWith("Seeded from"));
    const questsToAdd: Quest[] = generated.map(data => ({
      ...data,
      id: uid(),
      status: "active",
      createdAt: Date.now(),
      generatedBy: "ai",
    }));
    saveQuests([...manualQuests, ...questsToAdd]);
    setModal(null);
  }, [quests, saveQuests]);

  const aiGenerate = useCallback(async (profile: AIProfile) => {
    if (!player || !aiConnection) return;
    setAiError("");
    setIsGenerating(true);
    try {
      const tasks = await requestAiTaskBatch(aiConnection, profile, player, now);
      setDraftBatch(aiTasksToDrafts(tasks, now, profile, player));
      setModal("ai-review");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Task generation failed.");
    } finally { setIsGenerating(false); }
  }, [aiConnection, now, player]);

  const deployDraftBatch = useCallback(() => {
    if (draftBatch.length === 0) return;
    addGeneratedQuests(draftBatch);
    setDraftBatch([]);
  }, [addGeneratedQuests, draftBatch]);

  // ── Allocate stat ───────────────────────────────
  const allocateStat = useCallback((stat: keyof Stats) => {
    if (!player || player.unallocated <= 0) return;
    savePlayer({ ...player, stats: { ...player.stats, [stat]: player.stats[stat] + 1 }, unallocated: player.unallocated - 1 });
  }, [player, savePlayer]);

  // ── Onboarding ──────────────────────────────────
  const initPlayer = useCallback((codename: string) => {
    const clean = codename.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 20) || genCodename();
    const p: Player = {
      codename: clean,
      title: "RECRUIT",
      level: 1,
      xp: 0,
      totalXp: 0,
      hp: 100,
      maxHp: 100,
      gold: 0,
      streak: 0,
      lastCheckIn: todayStr(),
      joinDate: todayStr(),
      stats: { str: 5, int: 5, wis: 5, dex: 5, fth: 5, cha: 5 },
      perks: [],
      unallocated: 3,
    };
    savePlayer(p);
  }, [savePlayer]);

  // ── Reset ───────────────────────────────────────
  const resetAll = useCallback(() => {
    localStorage.removeItem(P_KEY);
    localStorage.removeItem(Q_KEY);
    localStorage.removeItem(PEN_KEY);
    penalizedRef.current.clear();
    setPlayer(null);
    setQuests([]);
    setScreen("home");
    setModal(null);
  }, []);

  const connectAi = useCallback((connection: AIConnection) => {
    localStorage.setItem(AI_CONNECTION_KEY, JSON.stringify(connection));
    setAiConnection(connection);
  }, []);

  // ── Deadline ────────────────────────────────────
  const deadline = todayMidnight();
  const detailQuest = detailId ? quests.find(q => q.id === detailId) : null;

  // ── No player → onboarding ──────────────────────
  if (!aiConnection) return <ApiSetupScreen onConnect={connectAi} />;
  if (!player) return <OnboardingScreen onInit={initPlayer} />;

  return (
    <div className="bg-background text-foreground h-screen flex flex-col items-center overflow-hidden">
      <div className="w-full max-w-[430px] h-full flex flex-col relative overflow-hidden">

        <SystemBar now={now} deadline={deadline} />

        {/* Main scrollable area */}
        <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {screen === "home" && (
            <HomeScreen
              player={player} quests={quests} now={now} deadline={deadline}
              onQuestTap={id => { setDetailId(id); setModal("quest-detail"); }}
              onAiGenerate={() => setModal("ai-generate")}
            />
          )}
          {screen === "quests" && (
            <QuestsScreen
              quests={quests} now={now}
              onQuestTap={id => { setDetailId(id); setModal("quest-detail"); }}
              onAdd={() => setModal("add-quest")}
            />
          )}
          {screen === "skills" && (
            <SkillsScreen player={player} onAllocate={allocateStat} />
          )}
          {screen === "loot" && (
            <LootScreen player={player} quests={quests} />
          )}
          {screen === "profile" && (
            <ProfileScreen player={player} quests={quests} onReset={() => setModal("confirm-reset")} />
          )}
        </div>

        <BottomNav screen={screen} nav={s => { setScreen(s); setModal(null); setDetailId(null); }} />

        {/* ── Modals / overlays ───────────────────── */}
        {modal === "quest-detail" && detailQuest && (
          <QuestDetailModal
            quest={detailQuest}
            now={now}
            onClose={() => { setModal(null); setDetailId(null); }}
            onComplete={() => completeQuest(detailQuest.id)}
            onToggleObj={id => toggleObj(detailQuest.id, id)}
          />
        )}
        {modal === "add-quest" && (
          <AddQuestModal
            now={now}
            onAdd={addQuest}
            onClose={() => setModal(null)}
          />
        )}
        {modal === "ai-generate" && (
          <AiGenerateModal
            profile={aiProfile}
            onChange={setAiProfile}
            onClose={() => setModal(null)}
            onGenerate={aiGenerate}
            isGenerating={isGenerating}
            error={aiError}
          />
        )}
        {modal === "ai-review" && draftBatch.length > 0 && (
          <AiBatchReviewModal
            batch={draftBatch}
            onChange={setDraftBatch}
            onDeploy={deployDraftBatch}
            onBack={() => setModal("ai-generate")}
          />
        )}
        {modal === "level-up" && levelUpFrom !== null && (
          <LevelUpModal
            player={player}
            oldLevel={levelUpFrom}
            onClose={() => { setModal(null); setLevelUpFrom(null); setDetailId(null); }}
          />
        )}
        {modal === "penalty" && penaltyData && (
          <PenaltyModal
            failedQuests={penaltyData.quests}
            totalHpLost={penaltyData.hp}
            player={player}
            onClose={() => { setModal(null); setPenaltyData(null); }}
          />
        )}
        {modal === "confirm-reset" && (
          <ConfirmResetModal
            onConfirm={resetAll}
            onCancel={() => setModal(null)}
          />
        )}
      </div>
    </div>
  );
}
