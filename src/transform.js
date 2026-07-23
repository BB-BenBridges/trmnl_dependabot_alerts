// TRMNL Serverless transform (Node.js)
// Fetches open Dependabot alerts for a GitHub org and returns
// total alert count + number of distinct repos affected.
//
// Required custom form fields on the plugin:
//   github_org   - your GitHub org name (e.g. "my-company")
//   github_token - a token with permission to read org Dependabot alerts
//                  (classic PAT with `security_events` + org read access,
//                   or fine-grained PAT with "Dependabot alerts: Read")

async function run(input) {
  const settings = input.trmnl?.plugin_settings?.custom_fields_values || {};
  const org = settings.github_org;
  const token = settings.github_pat;

  if (!org || !token) {
    return {
      error: "Missing github_org or github_token custom field",
      alert_count: 0,
      repo_count: 0
    };
  }

  const alerts = [];
  let url = `https://api.github.com/orgs/${org}/dependabot/alerts?state=open&per_page=100`;

  const startTime = Date.now();
  const TIME_BUDGET_MS = 4000; // stay under the 5s serverless limit

  while (url) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      // Ran out of time budget - return what we have rather than fail outright
      break;
    }

    let res;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "trmnl-dependabot-plugin",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
    } catch (err) {
      return {
        error: `Request failed: ${err.message}`,
        alert_count: 0,
        repo_count: 0
      };
    }

    if (!res.ok) {
      return {
        error: `GitHub API error: ${res.status} ${res.statusText}`,
        alert_count: 0,
        repo_count: 0
      };
    }

    const page = await res.json();
    alerts.push(...page);

    // Follow pagination via the Link header (rel="next")
    const linkHeader = res.headers.get("link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  const repos = new Set(
    alerts.map((a) => a.repository?.full_name).filter(Boolean)
  );

  const severity_counts = alerts.reduce((acc, a) => {
    const sev = a.security_advisory?.severity || "unknown";
    acc[sev] = (acc[sev] || 0) + 1;
    return acc;
  }, {});

  return {
    org,
    alert_count: alerts.length,
    repo_count: repos.size,
    severity_counts,
    generated_at: new Date().toISOString()
  };
}