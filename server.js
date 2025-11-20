// Simple HTTP server for GitHub App authentication backend
// Run with: node server.js

import "dotenv/config";
import http from "http";
import { URL } from "url";

const PORT = process.env.PORT || 3000;

// Your GitHub App credentials from .env
const GITHUB_APP_CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID;
const GITHUB_APP_CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET;
const APP_CALLBACK_URL = process.env.APP_CALLBACK_URL;
const GITHUB_ADMIN_PAT = process.env.GITHUB_ADMIN_PAT;

// Repository configuration for access control
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Jovit-Mathew236';
const GITHUB_REPO = process.env.GITHUB_REPO || 'plode-release-management';
const ACCESS_CONTROL_TYPE = process.env.ACCESS_CONTROL_TYPE || 'collaborator'; // 'collaborator' or 'organization'
const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION || '';

if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
  console.error("ERROR: Missing environment variables!");
  console.error(
    "Please set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET in .env file"
  );
  process.exit(1);
}

if (!GITHUB_ADMIN_PAT) {
  console.error("ERROR: Missing GITHUB_ADMIN_PAT environment variable!");
  console.error(
    "Please set GITHUB_ADMIN_PAT in .env file - this is your Personal Access Token for repo operations"
  );
  process.exit(1);
}

if (ACCESS_CONTROL_TYPE === 'organization' && !GITHUB_ORGANIZATION) {
  console.error("ERROR: GITHUB_ORGANIZATION is required when ACCESS_CONTROL_TYPE=organization");
  process.exit(1);
}

// Helper function to check if user is a collaborator with write access
async function isCollaborator(username) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/collaborators/${username}/permission`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `token ${GITHUB_ADMIN_PAT}`,
        "Accept": "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      console.error(`Error checking collaborator status: ${response.status}`);
      return false;
    }

    const data = await response.json();

    // Check if user has write, maintain, or admin permissions
    // Permissions: read, triage, write, maintain, admin
    const writePermissions = ['write', 'maintain', 'admin'];
    const hasWriteAccess = writePermissions.includes(data.permission);

    console.log(`User ${username} has permission: ${data.permission}, write access: ${hasWriteAccess}`);

    return hasWriteAccess;
  } catch (error) {
    console.error("Error checking collaborator status:", error);
    return false;
  }
}

// Helper function to check if user is an organization member with repo access
async function isOrganizationMember(username) {
  const memberUrl = `https://api.github.com/orgs/${GITHUB_ORGANIZATION}/members/${username}`;

  try {
    // First check if user is a member of the organization
    const memberResponse = await fetch(memberUrl, {
      headers: {
        "Authorization": `token ${GITHUB_ADMIN_PAT}`,
        "Accept": "application/vnd.github+json"
      }
    });

    if (memberResponse.status !== 204) {
      console.log(`User ${username} is not a member of organization ${GITHUB_ORGANIZATION}`);
      return false;
    }

    // Then check if they have write access to the specific repo
    const permissionUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/collaborators/${username}/permission`;
    const permResponse = await fetch(permissionUrl, {
      headers: {
        "Authorization": `token ${GITHUB_ADMIN_PAT}`,
        "Accept": "application/vnd.github+json"
      }
    });

    if (!permResponse.ok) {
      console.log(`User ${username} is an org member but has no access to repo ${GITHUB_OWNER}/${GITHUB_REPO}`);
      return false;
    }

    const data = await permResponse.json();
    const writePermissions = ['write', 'maintain', 'admin'];
    const hasWriteAccess = writePermissions.includes(data.permission);

    console.log(`User ${username} (org member) has permission: ${data.permission}, write access: ${hasWriteAccess}`);

    return hasWriteAccess;
  } catch (error) {
    console.error("Error checking organization membership:", error);
    return false;
  }
}

// Main access control check
async function hasAccess(username) {
  if (ACCESS_CONTROL_TYPE === 'organization') {
    console.log(`Checking organization membership for ${username} in ${GITHUB_ORGANIZATION}`);
    return await isOrganizationMember(username);
  } else {
    console.log(`Checking collaborator status for ${username} on ${GITHUB_OWNER}/${GITHUB_REPO}`);
    return await isCollaborator(username);
  }
}

// Helper function to get user info with email
async function getUserInfo(token) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get user info');
  }

  const user = await response.json();

  // If email is not public, fetch it from /user/emails
  if (!user.email) {
    try {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          "Authorization": `token ${token}`,
          "Accept": "application/vnd.github+json"
        }
      });

      if (emailsResponse.ok) {
        const emails = await emailsResponse.json();
        // Find the primary email
        const primaryEmail = emails.find(e => e.primary);
        if (primaryEmail) {
          user.email = primaryEmail.email;
        } else if (emails.length > 0) {
          // Fallback to first email if no primary
          user.email = emails[0].email;
        }
      }
    } catch (error) {
      console.error('Failed to fetch user emails:', error);
    }
  }

  return user;
}

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GitHub App authentication endpoint
  if (url.pathname === "/api/auth" && req.method === "POST") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        console.log("Received body:", body);
        const { code } = JSON.parse(body);

        console.log("Extracted code:", code);

        if (!code) {
          console.error("Error: No code provided");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Code is required" }));
          return;
        }

        // Exchange code for access token
        const tokenResponse = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              client_id: GITHUB_APP_CLIENT_ID,
              client_secret: GITHUB_APP_CLIENT_SECRET,
              code: code,
            }),
          }
        );

        const data = await tokenResponse.json();

        console.log("GitHub response:", data);

        if (data.error) {
          console.error("GitHub error:", data.error, data.error_description);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: data.error_description || data.error })
          );
          return;
        }

        console.log("Success! Access token received. Checking user permissions...");

        // Get user information
        const user = await getUserInfo(data.access_token);
        console.log(`User authenticated: ${user.login}`);

        // Check if user has access (collaborator or organization member)
        const userHasAccess = await hasAccess(user.login);

        if (!userHasAccess) {
          const accessType = ACCESS_CONTROL_TYPE === 'organization' ? 'organization member' : 'collaborator';
          const accessScope = ACCESS_CONTROL_TYPE === 'organization'
            ? `organization ${GITHUB_ORGANIZATION}`
            : `repository ${GITHUB_OWNER}/${GITHUB_REPO}`;

          console.log(`Access denied for user: ${user.login} - Not a ${accessType} with write access`);
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Access Denied",
            message: `You must be a ${accessType} with write access (or owner) to ${accessScope} to use this application. Please contact the repository owner to request access.`
          }));
          return;
        }

        // Ensure we have an email for commit attribution
        if (!user.email) {
          console.error(`No email found for user: ${user.login}`);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Email Required",
            message: "Unable to retrieve your email address. Please ensure you have a verified email set in your GitHub account and that it's visible to OAuth apps."
          }));
          return;
        }

        console.log(`Access granted for ${ACCESS_CONTROL_TYPE === 'organization' ? 'organization member' : 'collaborator'}: ${user.login} (${user.email})`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: data.access_token,
          admin_token: GITHUB_ADMIN_PAT,
          user: {
            login: user.login,
            avatar_url: user.avatar_url,
            name: user.name,
            email: user.email
          }
        }));
      } catch (error) {
        console.error("GitHub App authentication error:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error",
            details: error.message,
          })
        );
      }
    });
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`GitHub App authentication backend running on http://localhost:${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/api/auth`);
  console.log(`Callback URL: ${APP_CALLBACK_URL || 'Not configured'}`);
});
