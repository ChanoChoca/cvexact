import { describe, expect, it } from "vitest";
import * as greenhouse from "@/scripts/jobs/ats/greenhouse.mjs";
import * as lever from "@/scripts/jobs/ats/lever.mjs";
import * as ashby from "@/scripts/jobs/ats/ashby.mjs";
import * as recruitee from "@/scripts/jobs/ats/recruitee.mjs";
import * as workable from "@/scripts/jobs/ats/workable.mjs";
import * as smartrecruiters from "@/scripts/jobs/ats/smartrecruiters.mjs";

/**
 * Each ATS adapter (`scripts/jobs/ats/*.mjs`) turns one ATS's own JSON shape
 * into `job_posting` rows. The two rules every source in this project already
 * follows (`scripts/ingest-jobs.mjs`) and that the ATS adapters have to as
 * well: `country` is only ever set with positive evidence in the location
 * text (one unambiguous country, never a guess); and `workMode` is only ever "onsite" alongside
 * `country === "AR"` — the Arbeitnow bug (a "Presencial" filter surfacing
 * mostly German listings) is exactly what happens when those two drift apart.
 */

const entry = (overrides: Partial<{ ats: string; token: string; name: string }> = {}) => ({
  ats: "test",
  token: "acme",
  name: "Acme",
  ...overrides,
});

describe("greenhouse adapter", () => {
  it("reads Argentine onsite listings, and leaves everything else unknown", () => {
    const body = {
      jobs: [
        {
          id: 1,
          title: "Backend Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          location: { name: "Buenos Aires, Argentina" },
          content: "<p>Buscamos</p>",
          departments: [{ name: "Engineering" }],
          updated_at: "2026-08-30T00:00:00Z",
        },
        {
          id: 2,
          title: "Frontend Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
          location: { name: "Berlin, Germany" },
          content: "<p>We build</p>",
          departments: [],
          updated_at: "2026-08-30T00:00:00Z",
        },
      ],
    };
    const [ar, de] = greenhouse.rows(body, entry({ ats: "greenhouse" }));

    expect(ar.id).toBe("greenhouse:acme:1");
    expect(ar.country).toBe("AR");
    expect(ar.workMode).toBe("onsite");

    expect(de.country).toBe("DE");
    // Not Argentina and not declared remote — "unknown", never "onsite".
    expect(de.workMode).toBe("unknown");
  });

  it("skips entries with no title or no id", () => {
    const rows = greenhouse.rows({ jobs: [{ id: null, title: "X" }, { id: 1, title: "" }] }, entry());
    expect(rows).toHaveLength(0);
  });
});

describe("lever adapter", () => {
  it("reads workplaceType and salaryRange when present", () => {
    const body = [
      {
        id: "abc",
        text: "Senior Backend Engineer",
        hostedUrl: "https://jobs.lever.co/acme/abc",
        workplaceType: "remote",
        categories: { location: "Remote", team: "Platform" },
        descriptionPlain: "Buscamos",
        salaryRange: { min: 1000, max: 2000, currency: "USD" },
        createdAt: "1735689600000",
      },
    ];
    const [row] = lever.rows(body, entry({ ats: "lever" }));

    expect(row.id).toBe("lever:acme:abc");
    expect(row.workMode).toBe("remote");
    expect(row.salaryMin).toBe(1000);
    expect(row.salaryMax).toBe(2000);
    expect(row.salaryCurrency).toBe("USD");
  });

  it("only reports onsite for an on-site posting with Argentine location text", () => {
    const madeUp = (location: string, workplaceType: string) => [
      {
        id: "x",
        text: "Role",
        hostedUrl: "https://jobs.lever.co/acme/x",
        workplaceType,
        categories: { location },
      },
    ];
    const [ar] = lever.rows(madeUp("Buenos Aires, Argentina", "on-site"), entry());
    expect(ar.country).toBe("AR");
    expect(ar.workMode).toBe("onsite");

    const [other] = lever.rows(madeUp("Berlin, Germany", "on-site"), entry());
    expect(other.country).toBe("DE");
    expect(other.workMode).toBe("unknown");
  });
});

describe("ashby adapter", () => {
  it("reads isRemote and compensation summary components", () => {
    const body = {
      jobs: [
        {
          id: "j1",
          title: "Staff Engineer",
          jobUrl: "https://jobs.ashbyhq.com/acme/j1",
          location: "Remote",
          isRemote: true,
          department: "Engineering",
          descriptionHtml: "<p>Buscamos</p>",
          compensation: {
            summaryComponents: [{ minValue: 3000, maxValue: 5000, currencyCode: "USD" }],
          },
          publishedAt: "2026-08-30T00:00:00Z",
        },
      ],
    };
    const [row] = ashby.rows(body, entry({ ats: "ashby" }));

    expect(row.workMode).toBe("remote");
    expect(row.seniority).toBe("lead"); // "Staff" maps to lead
    expect(row.salaryMin).toBe(3000);
    expect(row.salaryMax).toBe(5000);
  });
});

describe("recruitee adapter", () => {
  it("reads the remote boolean and city/country fields directly", () => {
    const body = {
      offers: [
        {
          id: 5,
          title: "QA Engineer",
          careers_apply_url: "https://acme.recruitee.com/o/qa-engineer",
          city: "Córdoba",
          country: "Argentina",
          remote: false,
          description: "<p>Buscamos</p>",
          department: "QA",
          published_at: "2026-08-30T00:00:00Z",
        },
      ],
    };
    const [row] = recruitee.rows(body, entry({ ats: "recruitee" }));

    expect(row.country).toBe("AR");
    expect(row.workMode).toBe("onsite");
    expect(row.location).toBe("Córdoba, Argentina");
  });
});

describe("workable adapter", () => {
  it("reads workplace/telecommuting and city/region/country location", () => {
    const body = {
      jobs: [
        {
          shortcode: "abc123",
          title: "Data Engineer",
          url: "https://apply.workable.com/acme/j/abc123",
          location: { city: "Rosario", region: "Santa Fe", country: "Argentina", countryCode: "AR", workplace: "on-site" },
          department: "Data",
          description: "<p>Buscamos</p>",
          created: "2026-08-30T00:00:00Z",
        },
      ],
    };
    const [row] = workable.rows(body, entry({ ats: "workable" }));

    expect(row.country).toBe("AR");
    expect(row.workMode).toBe("onsite");
  });

  it("falls back to the legacy telecommuting flag for remote", () => {
    const body = {
      jobs: [
        {
          shortcode: "rem1",
          title: "Remote Designer",
          url: "https://apply.workable.com/acme/j/rem1",
          location: { city: "", region: "", country: "" },
          telecommuting: true,
        },
      ],
    };
    const [row] = workable.rows(body, entry());
    expect(row.workMode).toBe("remote");
  });
});

describe("smartrecruiters adapter", () => {
  it("sets canPrefill from whether a description actually came back", () => {
    const withDescription = {
      content: [
        {
          id: "p1",
          name: "Product Manager",
          applyUrl: "https://jobs.smartrecruiters.com/acme/p1",
          location: { city: "Buenos Aires", country: "Argentina", remote: false },
          jobAd: { sections: { jobDescription: { text: "Buscamos un PM" } } },
        },
      ],
    };
    const [withDesc] = smartrecruiters.rows(withDescription, entry({ ats: "smartrecruiters" }));
    expect(withDesc.canPrefill).toBe(true);
    expect(withDesc.country).toBe("AR");
    expect(withDesc.workMode).toBe("onsite");

    const withoutDescription = {
      content: [
        {
          id: "p2",
          name: "Other Role",
          applyUrl: "https://jobs.smartrecruiters.com/acme/p2",
          location: { city: "", country: "", remote: false },
        },
      ],
    };
    const [noDesc] = smartrecruiters.rows(withoutDescription, entry());
    expect(noDesc.canPrefill).toBe(false);
    expect(noDesc.workMode).toBe("unknown");
  });
});
