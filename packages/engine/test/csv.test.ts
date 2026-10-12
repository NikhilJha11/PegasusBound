import { describe, expect, it } from "vitest";
import { parseProspectCsv } from "../src/importers/csv";

describe("parseProspectCsv", () => {
  it("maps headers, splits names, rejects bad rows and dedupes", () => {
    const csv = [
      "Full Name,Work Email,Company Name,Job Title,Country",
      "Ada Lovelace,ada@example.com,Analytical Ltd,CEO,UK",
      "Bad Row,not-an-email,X,Y,Z",
      "Ada Again,ADA@example.com,Analytical Ltd,CEO,UK",
      ",,,,",
    ].join("\n");
    const r = parseProspectCsv(csv);
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]).toMatchObject({
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Ltd",
      title: "CEO",
      attributes: { Country: "UK" },
    });
    expect(r.duplicatesInFile).toBe(1);
    expect(r.rejected).toEqual([{ row: 3, reason: 'Invalid email "not-an-email"' }]);
  });

  it("throws without an email column", () => {
    expect(() => parseProspectCsv("name,company\nA,B")).toThrow(/No email column/);
  });
});
