import { parse } from "csv-parse/sync";

export interface ImportedContact {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  persona?: string;
  attributes: Record<string, string>;
}

export interface CsvImportResult {
  contacts: ImportedContact[];
  mapping: Record<string, string | null>;
  rejected: { row: number; reason: string }[];
  duplicatesInFile: number;
}

const FIELD_HEADERS: Record<keyof Omit<ImportedContact, "attributes">, string[]> = {
  email: ["email", "e-mail", "email address", "work email", "emailaddress", "contact email"],
  firstName: ["first name", "firstname", "first", "given name"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  company: ["company", "company name", "organization", "organisation", "account", "account name"],
  title: ["title", "job title", "role", "position"],
  persona: ["persona", "segment"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();

export function parseProspectCsv(text: string, overrides: Record<string, string> = {}): CsvImportResult {
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Record<string, string>[];
  const headers = rows.length ? Object.keys(rows[0]!) : [];
  const mapping: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(FIELD_HEADERS)) {
    mapping[field] = overrides[field] ?? headers.find((h) => aliases.includes(norm(h))) ?? null;
  }
  const nameCol = headers.find((h) => ["name", "full name", "contact name"].includes(norm(h)));
  if (!mapping.email) throw new Error(`No email column found. Headers: ${headers.join(", ")}`);

  const seen = new Set<string>();
  const contacts: ImportedContact[] = [];
  const rejected: CsvImportResult["rejected"] = [];
  let duplicatesInFile = 0;
  const mapped = new Set(Object.values(mapping).filter(Boolean));

  rows.forEach((row, i) => {
    if (Object.values(row).every((v) => !v?.trim())) return;
    const email = (row[mapping.email!] ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      rejected.push({ row: i + 2, reason: email ? `Invalid email "${email}"` : "Missing email" });
      return;
    }
    if (seen.has(email)) {
      duplicatesInFile++;
      return;
    }
    seen.add(email);
    const get = (f: string) => (mapping[f] ? row[mapping[f]!]?.trim() || undefined : undefined);
    let firstName = get("firstName");
    let lastName = get("lastName");
    if (!firstName && nameCol && row[nameCol]) {
      const parts = row[nameCol]!.trim().split(/\s+/);
      firstName = parts[0];
      lastName ??= parts.slice(1).join(" ") || undefined;
    }
    const attributes: Record<string, string> = {};
    for (const h of headers) if (!mapped.has(h) && h !== nameCol && row[h]) attributes[h] = row[h]!;
    contacts.push({ email, firstName, lastName, company: get("company"), title: get("title"), persona: get("persona"), attributes });
  });

  return { contacts, mapping, rejected, duplicatesInFile };
}
