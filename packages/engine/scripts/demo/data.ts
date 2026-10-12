// Synthetic, deterministic demo data for the Bridged workspace: 1,000
// prospects at fictional publishers, split across four campaigns. No email is
// ever sent to these addresses (the demo runs on the mock sender).
import type { CampaignBrief } from "../../src/db/schema";
import type { ContactInput } from "../../src/orchestrator/campaigns";

const sender = { senderName: "Nikhil", senderCompany: "Bridged" };

export const SEGMENTS: {
  key: string;
  name: string;
  size: number;
  /** Simulated day the campaign launches; negative = planned today, after the run. */
  startDay: number;
  titles: string[];
  regions: string[];
  brief: CampaignBrief;
}[] = [
  {
    key: "audience",
    name: "Audience leaders · US & UK publishers",
    size: 360,
    startDay: 0,
    titles: ["Head of Audience", "Director of Audience Development", "VP Audience", "Head of Audience Growth", "Audience Development Lead"],
    regions: ["US", "UK"],
    brief: {
      campaignType: "Pain-point-led outreach",
      objective: "Book qualified intro calls with audience leaders",
      icp: "Digital publishers with 1M+ monthly readers in the US and UK",
      persona: "Head of Audience",
      offer: "A two-week Bridged pilot on one section",
      style: "Short, peer-to-peer, plain text",
      context: "Lead with reader engagement and newsletter sign-ups.",
      ...sender,
    },
  },
  {
    key: "revenue",
    name: "Revenue leaders · media groups",
    size: 320,
    startDay: 4,
    titles: ["Chief Revenue Officer", "VP Ad Sales", "SVP Revenue", "Head of Commercial", "Director of Sponsorships"],
    regions: ["US", "UK", "India"],
    brief: {
      campaignType: "Revenue-led outreach",
      objective: "Book qualified calls with revenue leaders about premium inventory",
      icp: "Media groups running several titles on one shared ad stack",
      persona: "Chief Revenue Officer / VP Ad Sales",
      offer: "Sponsored interactive units that sell at a premium",
      style: "Concise, commercial, evidence-led",
      context: "Sponsors want engagement proof; CPMs are falling.",
      ...sender,
    },
  },
  {
    key: "founders",
    name: "Founders · independent publishers",
    size: 200,
    startDay: 11,
    titles: ["Founder", "Co-founder & CEO", "CEO", "Founder & Editor-in-Chief", "Managing Director"],
    regions: ["India", "UK", "US"],
    brief: {
      campaignType: "Founder-to-founder outreach",
      objective: "Start conversations with founders of independent digital publishers",
      icp: "Independent digital publishers with 500K+ monthly readers",
      persona: "Founder / CEO",
      offer: "A two-week Bridged pilot on one section",
      style: "Direct, founder-to-founder, very short",
      context: "Founders own growth and the P&L end to end.",
      ...sender,
    },
  },
  {
    key: "product",
    name: "Product leaders · news apps",
    size: 120,
    startDay: -1,
    titles: ["Head of Product", "Director of Digital Product", "VP Product", "Head of Digital"],
    regions: ["US", "UK"],
    brief: {
      campaignType: "Experience-led outreach",
      objective: "Book qualified calls with product leaders at news publishers",
      icp: "News publishers with a mobile app and 2M+ monthly readers",
      persona: "Head of Product",
      offer: "A two-week Bridged pilot on one section",
      style: "Short and practical",
      context: "Owns the reading experience and site performance.",
      ...sender,
    },
  },
];

const FIRST = [
  "Priya", "Marcus", "Elena", "James", "Aisha", "Tom", "Sofia", "Daniel", "Meera", "Oliver", "Hannah", "Rahul", "Grace", "Lucas", "Ananya", "Ethan",
  "Chloe", "Arjun", "Isabel", "Noah", "Zara", "Leo", "Kavya", "Sam", "Amelia", "Rohan", "Emma", "Vikram", "Lily", "Kabir", "Maya", "Jack",
  "Nina", "Aditya", "Ruby", "Harry", "Tara", "Ben", "Ishaan", "Freya", "Omar", "Leah", "Dev", "Clara", "Sanjay", "Ella", "Matt", "Neha",
];
const LAST = [
  "Shah", "Bennett", "Rossi", "Carter", "Khan", "Hughes", "Moreno", "Fischer", "Iyer", "Walsh", "Clarke", "Mehta", "Turner", "Silva", "Rao", "Price",
  "Dubois", "Kapoor", "Reyes", "Foster", "Malik", "Hayes", "Nair", "Brooks", "Evans", "Gupta", "Wright", "Menon", "Ward", "Bose", "Patel", "Murphy",
];
const P1 = ["Harbor", "Lantern", "Meridian", "Northgate", "Riverside", "Summit", "Beacon", "Granite", "Bluebird", "Copperline", "Evergreen", "Highland", "Ironbridge", "Juniper", "Keystone", "Lakeshore", "Maplewood", "Oakridge", "Pinecrest", "Redwood", "Silverline", "Tidewater", "Westbrook", "Windmill", "Crescent", "Fernhill", "Foxglove", "Kingsway", "Larkspur", "Moorland"];
const P2 = ["Daily", "Media", "Press", "Times", "Herald", "Digital", "Post", "Gazette", "Chronicle", "Network", "News", "Courier", "Ledger", "Review", "Journal"];
const TLD: Record<string, string[]> = { US: ["com"], UK: ["co.uk", "com"], India: ["in", "com"] };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Emails are unique across all segments, so the workspace holds exactly 1,000 people.
const usedEmails = new Set<string>();

export function prospectsFor(seg: (typeof SEGMENTS)[number]): ContactInput[] {
  const offset = SEGMENTS.slice(0, SEGMENTS.indexOf(seg)).reduce((n, g) => n + g.size, 0);
  const rand = rng(1000 + SEGMENTS.indexOf(seg));
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]!;
  const out: ContactInput[] = [];
  const used = usedEmails;
  for (let i = 0; out.length < seg.size; i++) {
    // Companies are spread so each has 1–3 contacts, like a real list.
    const c = (offset + Math.floor(i / 2) * 7 + i) % (P1.length * P2.length);
    const company = `${P1[c % P1.length]} ${P2[Math.floor(c / P1.length) % P2.length]}`;
    const region = pick(seg.regions);
    const domain = `${company.toLowerCase().replace(/[^a-z]+/g, "")}.${pick(TLD[region]!)}`;
    const first = pick(FIRST);
    const last = pick(LAST);
    const email = `${first}.${last}@${domain}`.toLowerCase();
    if (used.has(email)) continue;
    used.add(email);
    out.push({
      email,
      firstName: first,
      lastName: last,
      company,
      title: pick(seg.titles),
      persona: seg.brief.persona,
      attributes: { region, monthly_readers: `${1 + Math.floor(rand() * 24)}M`, source: "Demo list (synthetic)" },
    });
  }
  return out;
}
